import { computeContentHash } from "../assembler/content-hash.js";
import { detectCycleInChain } from "../invariants/cycle-detection.js";
import type { AgentSpecContent } from "../schema/agent-spec-content.js";
import type { CallContext } from "../schema/call-context.js";
import type { AgentCallPolicyEdge } from "../schema/agent-call-policy-edge.js";
import type { RuntimeBindingArtifact } from "../schema/runtime-binding.js";
import type {
  AgentLifecycleEvidencePayload,
  AttestationEnvelope,
  AttestationEvidenceKind,
  AttestedAgentLifecycleEvidence,
  AttestedCallGraphEdgeApproval,
  LifecycleEvidenceRole,
} from "../schema/runtime-attestation.js";
import {
  ACTING_LIFECYCLE_ATTESTATION_DOMAIN,
  CALL_GRAPH_EDGE_APPROVAL_ATTESTATION_DOMAIN,
  CALLEE_LIFECYCLE_ATTESTATION_DOMAIN,
  RUNTIME_BINDING_ATTESTATION_DOMAIN,
} from "../schema/runtime-attestation.js";
import type {
  AgentCallRuntimeAction,
  RuntimeAuthorizationInput,
  RuntimeAuthorizationResult,
  TrustedRuntimeAuthorizationContext,
  ToolCallRuntimeAction,
} from "../schema/runtime-authorization.js";
import {
  RuntimeAuthorizationInputSchema,
  TrustedRuntimeAuthorizationContextSchema,
} from "../schema/runtime-authorization.js";
import {
  isRuntimeBudgetMonotonic,
  remainingRuntimeBudgetFromContext,
} from "./runtime-budget.js";
import {
  type RuntimeAttestationDomain,
  verifyEd25519Attestation,
} from "./runtime-attestation.js";

export const RUNTIME_EXECUTABLE_STATES = ["deployed"] as const;

/**
 * Callee callability is intentionally modeled separately from caller
 * executability. The state sets are currently identical, but the concepts and
 * future policy evolution are distinct.
 */
export const CALLEE_CALLABLE_STATES = ["deployed"] as const;
function isExecutableState(state: string): boolean {
  return RUNTIME_EXECUTABLE_STATES.some((executableState) => executableState === state);
}

function isCallableState(state: string): boolean {
  return CALLEE_CALLABLE_STATES.some((callableState) => callableState === state);
}

function validateAttestation(
  evidenceKind: AttestationEvidenceKind,
  domain: RuntimeAttestationDomain,
  payload: unknown,
  envelope: AttestationEnvelope,
  context: TrustedRuntimeAuthorizationContext,
): RuntimeAuthorizationResult | undefined {
  const trustedKey = context.attestationKeys.find(
    (key) =>
      key.keyId === envelope.keyId &&
      key.allowedEvidenceKinds.some((allowedKind) => allowedKind === evidenceKind),
  );
  if (trustedKey === undefined) {
    return {
      outcome: "blocked",
      reason: {
        type: "attestation_key_unknown",
        evidenceKind,
        keyId: envelope.keyId,
      },
    };
  }

  if (!verifyEd25519Attestation(domain, payload, envelope, trustedKey)) {
    return {
      outcome: "blocked",
      reason: {
        type: "attestation_invalid",
        evidenceKind,
        keyId: envelope.keyId,
      },
    };
  }

  return undefined;
}

function validateRuntimeBindingValidity(
  binding: RuntimeBindingArtifact,
  context: TrustedRuntimeAuthorizationContext,
): RuntimeAuthorizationResult | undefined {
  // Both values passed strict RFC 3339 schemas. Compare parsed instants rather
  // than timestamp strings so equivalent offsets have identical semantics.
  const deployedAtEpochMs = Date.parse(binding.deployedAt);
  const authorizationTimeEpochMs = Date.parse(context.authorizationTime);

  if (authorizationTimeEpochMs < deployedAtEpochMs) {
    return {
      outcome: "blocked",
      reason: { type: "runtime_binding_not_yet_valid", bindingId: binding.bindingId },
    };
  }

  const expiresAtEpochMs = deployedAtEpochMs + binding.ttl * 1_000;
  if (authorizationTimeEpochMs >= expiresAtEpochMs) {
    return {
      outcome: "blocked",
      reason: { type: "runtime_binding_expired", bindingId: binding.bindingId },
    };
  }

  return undefined;
}

function validateLifecycleFreshness(
  payload: AgentLifecycleEvidencePayload,
  role: LifecycleEvidenceRole,
  context: TrustedRuntimeAuthorizationContext,
): RuntimeAuthorizationResult | undefined {
  const assertedAtEpochMs = Date.parse(payload.assertedAt);
  const authorizationTimeEpochMs = Date.parse(context.authorizationTime);

  if (authorizationTimeEpochMs < assertedAtEpochMs) {
    return {
      outcome: "blocked",
      reason: {
        type: "lifecycle_evidence_not_fresh",
        role,
        condition: "from_future",
        specId: payload.specId,
        versionOrChannel: payload.versionOrChannel,
      },
    };
  }

  const expiresAtEpochMs = assertedAtEpochMs + payload.freshnessTtl * 1_000;
  if (authorizationTimeEpochMs >= expiresAtEpochMs) {
    return {
      outcome: "blocked",
      reason: {
        type: "lifecycle_evidence_not_fresh",
        role,
        condition: "expired",
        specId: payload.specId,
        versionOrChannel: payload.versionOrChannel,
      },
    };
  }

  return undefined;
}

function recomputeSpecContentHash(spec: AgentSpecContent): string {
  const { contentHash: _ignored, ...contentWithoutHash } = spec;
  return computeContentHash(contentWithoutHash);
}

function validateRuntimeEvidence(
  input: RuntimeAuthorizationInput,
  context: TrustedRuntimeAuthorizationContext,
): RuntimeAuthorizationResult | undefined {
  if (input.runtimeBindingEvidence === undefined) {
    return {
      outcome: "blocked",
      reason: {
        type: "runtime_binding_missing",
        specId: input.spec.specId,
        version: input.spec.version,
      },
    };
  }

  const bindingEvidence = input.runtimeBindingEvidence;
  const bindingAttestationBlock = validateAttestation(
    "runtime_binding",
    RUNTIME_BINDING_ATTESTATION_DOMAIN,
    bindingEvidence.payload,
    bindingEvidence.attestation,
    context,
  );
  if (bindingAttestationBlock) {
    return bindingAttestationBlock;
  }

  if (
    bindingEvidence.payload.specId !== input.spec.specId ||
    bindingEvidence.payload.version !== input.spec.version
  ) {
    return {
      outcome: "blocked",
      reason: {
        type: "runtime_subject_mismatch",
        specId: input.spec.specId,
        version: input.spec.version,
      },
    };
  }

  const recomputedContentHash = recomputeSpecContentHash(input.spec);
  if (
    recomputedContentHash !== input.spec.contentHash ||
    recomputedContentHash !== bindingEvidence.payload.contentHash
  ) {
    return {
      outcome: "blocked",
      reason: {
        type: "runtime_binding_content_hash_mismatch",
        specId: input.spec.specId,
        version: input.spec.version,
      },
    };
  }

  const bindingValidityBlock = validateRuntimeBindingValidity(
    bindingEvidence.payload,
    context,
  );
  if (bindingValidityBlock) {
    return bindingValidityBlock;
  }

  const actingEvidence = input.actingLifecycleEvidence;
  const actingAttestationBlock = validateAttestation(
    "acting_lifecycle",
    ACTING_LIFECYCLE_ATTESTATION_DOMAIN,
    actingEvidence.payload,
    actingEvidence.attestation,
    context,
  );
  if (actingAttestationBlock) {
    return actingAttestationBlock;
  }

  if (
    actingEvidence.payload.specId !== input.spec.specId ||
    actingEvidence.payload.versionOrChannel !== input.spec.version
  ) {
    return {
      outcome: "blocked",
      reason: {
        type: "lifecycle_evidence_subject_mismatch",
        role: "acting",
        specId: input.spec.specId,
        versionOrChannel: input.spec.version,
      },
    };
  }

  if (!isExecutableState(actingEvidence.payload.state)) {
    return {
      outcome: "blocked",
      reason: {
        type: "runtime_state_not_executable",
        state: actingEvidence.payload.state,
      },
    };
  }

  return validateLifecycleFreshness(actingEvidence.payload, "acting", context);
}

function validateCallContext(input: RuntimeAuthorizationInput): CallContext | RuntimeAuthorizationResult {
  const tail = input.callContext.callChain.at(-1);
  if (tail !== input.spec.specId) {
    return {
      outcome: "blocked",
      reason: { type: "call_context_invalid", reason: "acting_spec_not_call_chain_tail" },
    };
  }

  return input.callContext;
}

function authorizeToolCall(
  input: RuntimeAuthorizationInput,
  action: ToolCallRuntimeAction,
): RuntimeAuthorizationResult {
  const declarations = input.spec.declaredTools.filter((tool) => tool.toolId === action.toolId);
  if (declarations.length === 0) {
    return { outcome: "blocked", reason: { type: "tool_not_declared", toolId: action.toolId } };
  }

  // v0.1 has no scope algebra. Exact match is the only safe containment proof.
  if (!declarations.some((tool) => tool.scope === action.scope)) {
    return {
      outcome: "blocked",
      reason: { type: "tool_scope_not_allowed", toolId: action.toolId, scope: action.scope },
    };
  }

  return { outcome: "allowed", actionType: "tool_call" };
}

function selectRelevantEdgeApprovals(
  input: RuntimeAuthorizationInput,
  action: AgentCallRuntimeAction,
): AttestedCallGraphEdgeApproval[] {
  const matches: AttestedCallGraphEdgeApproval[] = [];
  for (const approvalEvidence of input.attestedEdgeApprovals) {
    const edge = approvalEvidence.payload.edge;
    const matchesEdge =
      edge.callerSpecId === input.spec.specId &&
      edge.callerVersion === input.spec.version &&
      edge.calleeSpecId === action.calleeSpecId &&
      edge.calleeVersionOrChannel === action.calleeVersionOrChannel &&
      edge.trustDomainId === input.spec.trustDomainId;
    if (matchesEdge) {
      matches.push(approvalEvidence);
    }
  }
  return matches;
}

function deriveNextCallContext(
  callContext: CallContext,
  action: AgentCallRuntimeAction,
  declaredMaxDepth: number,
  edgeMaxDepth: number,
  currentRunId: string,
): CallContext {
  return {
    rootRunId: callContext.rootRunId,
    parentRunId: currentRunId,
    callChain: [...callContext.callChain, action.calleeSpecId],
    remainingDepth: Math.min(callContext.remainingDepth - 1, declaredMaxDepth - 1, edgeMaxDepth - 1),
    remainingCallBudget: action.childBudget.callBudget,
    remainingTokenBudget: action.childBudget.tokenBudget,
    remainingTimeBudget: action.childBudget.timeBudget,
  };
}

function validateCalleeLifecycleEvidence(
  evidence: AttestedAgentLifecycleEvidence | undefined,
  action: AgentCallRuntimeAction,
  context: TrustedRuntimeAuthorizationContext,
): RuntimeAuthorizationResult | undefined {
  if (evidence === undefined) {
    return {
      outcome: "blocked",
      reason: {
        type: "callee_lifecycle_evidence_missing",
        calleeSpecId: action.calleeSpecId,
        calleeVersionOrChannel: action.calleeVersionOrChannel,
      },
    };
  }

  const attestationBlock = validateAttestation(
    "callee_lifecycle",
    CALLEE_LIFECYCLE_ATTESTATION_DOMAIN,
    evidence.payload,
    evidence.attestation,
    context,
  );
  if (attestationBlock) {
    return attestationBlock;
  }

  if (
    evidence.payload.specId !== action.calleeSpecId ||
    evidence.payload.versionOrChannel !== action.calleeVersionOrChannel
  ) {
    return {
      outcome: "blocked",
      reason: {
        type: "lifecycle_evidence_subject_mismatch",
        role: "callee",
        specId: action.calleeSpecId,
        versionOrChannel: action.calleeVersionOrChannel,
      },
    };
  }

  if (!isCallableState(evidence.payload.state)) {
    return {
      outcome: "blocked",
      reason: {
        type: "callee_state_not_callable",
        calleeSpecId: action.calleeSpecId,
        calleeVersionOrChannel: action.calleeVersionOrChannel,
        state: evidence.payload.state,
      },
    };
  }

  return validateLifecycleFreshness(evidence.payload, "callee", context);
}

function authorizeAgentCall(
  input: RuntimeAuthorizationInput,
  action: AgentCallRuntimeAction,
  callContext: CallContext,
  context: TrustedRuntimeAuthorizationContext,
): RuntimeAuthorizationResult {
  const declaredCall = input.spec.declaredAgentCalls.find(
    (call) =>
      call.calleeSpecId === action.calleeSpecId &&
      call.calleeVersionOrChannel === action.calleeVersionOrChannel,
  );
  if (!declaredCall) {
    return {
      outcome: "blocked",
      reason: {
        type: "agent_call_not_declared",
        calleeSpecId: action.calleeSpecId,
        calleeVersionOrChannel: action.calleeVersionOrChannel,
      },
    };
  }

  const relevantApprovalEvidence = selectRelevantEdgeApprovals(input, action);
  for (const approvalEvidence of relevantApprovalEvidence) {
    const attestationBlock = validateAttestation(
      "call_graph_edge_approval",
      CALL_GRAPH_EDGE_APPROVAL_ATTESTATION_DOMAIN,
      approvalEvidence.payload,
      approvalEvidence.attestation,
      context,
    );
    if (attestationBlock) {
      return attestationBlock;
    }
  }

  const approvedEdges = relevantApprovalEvidence
    .filter((approvalEvidence) => approvalEvidence.payload.decision === "approved")
    .map((approvalEvidence) => approvalEvidence.payload.edge);
  if (approvedEdges.length === 0) {
    return {
      outcome: "blocked",
      reason: {
        type: "call_edge_not_approved",
        calleeSpecId: action.calleeSpecId,
        calleeVersionOrChannel: action.calleeVersionOrChannel,
      },
    };
  }

  if (approvedEdges.some((edge) => edge.requiresHumanGate)) {
    return {
      outcome: "blocked",
      reason: {
        type: "human_gate_required",
        calleeSpecId: action.calleeSpecId,
        calleeVersionOrChannel: action.calleeVersionOrChannel,
      },
    };
  }

  if (approvedEdges.length > 1) {
    return {
      outcome: "blocked",
      reason: {
        type: "ambiguous_call_edge_approval",
        calleeSpecId: action.calleeSpecId,
        calleeVersionOrChannel: action.calleeVersionOrChannel,
      },
    };
  }

  const edge = approvedEdges[0] as AgentCallPolicyEdge;

  if (!declaredCall.allowedIntents.includes(action.intent) || !edge.allowedIntents.includes(action.intent)) {
    return { outcome: "blocked", reason: { type: "call_intent_not_allowed", intent: action.intent } };
  }

  if (detectCycleInChain(callContext.callChain, action.calleeSpecId)) {
    return { outcome: "blocked", reason: { type: "cycle_detected", calleeSpecId: action.calleeSpecId } };
  }

  const calleeLifecycleBlock = validateCalleeLifecycleEvidence(
    input.calleeLifecycleEvidence,
    action,
    context,
  );
  if (calleeLifecycleBlock) {
    return calleeLifecycleBlock;
  }

  const effectiveDepth = Math.min(callContext.remainingDepth, declaredCall.maxDepth, edge.maxDepth);
  if (effectiveDepth <= 0) {
    return { outcome: "blocked", reason: { type: "depth_exhausted" } };
  }

  if (callContext.remainingCallBudget <= 0) {
    return { outcome: "blocked", reason: { type: "call_budget_exhausted" } };
  }

  const maxChildCallBudget = Math.min(declaredCall.maxCallsPerRun, edge.maxCallsPerRun);
  if (action.childBudget.callBudget > maxChildCallBudget) {
    return {
      outcome: "blocked",
      reason: { type: "budget_increase_forbidden", budget: action.childBudget },
    };
  }

  if (!isRuntimeBudgetMonotonic(remainingRuntimeBudgetFromContext(callContext), action.childBudget)) {
    return {
      outcome: "blocked",
      reason: { type: "budget_increase_forbidden", budget: action.childBudget },
    };
  }

  return {
    outcome: "allowed",
    actionType: "agent_call",
    nextCallContext: deriveNextCallContext(
      callContext,
      action,
      declaredCall.maxDepth,
      edge.maxDepth,
      input.currentRunId,
    ),
  };
}

/**
 * Data Plane Runtime Harness v0.1. This is an authorization and context
 * derivation layer only: it never executes tools, never touches network,
 * memory, registry, DB, deployment state, or human-gate decisions.
 *
 * Known v0.1 boundaries:
 * - Runtime authorization consumes a signed full RuntimeBindingArtifact and
 *   recomputes the presented spec content hash. Mutable runtime metadata is not
 *   an authorization input or authority source.
 * - Acting and callee lifecycle claims are Ed25519-attested and bounded by a
 *   maximum 300-second freshness lease. Freshness limits replay but does not
 *   prove synchronous current state after the assertion instant.
 * - Agent-call authority comes only from complete, decided, Ed25519-attested
 *   call-graph edge approval artifacts. Every selected artifact is verified
 *   before its decision or policy fields are used.
 * - Parent context spend-down is caller-owned in v0.1. This function returns
 *   the authorized child context; it does not mutate or return the parent
 *   context for later sibling calls. Call context, run identity, cycle chain,
 *   and remaining budgets are not attested until a later slice.
 * - Edge approval attestation proves presented origin and integrity, not that
 *   the artifact is the latest canonical decision, remains unrevoked, or is
 *   protected from replay. decidedAt is not an authority-freshness lease.
 * - External signing, private-key custody, KMS/HSM, key revocation, nonce replay
 *   storage, synchronous lifecycle lookup, process liveness, channel resolution,
 *   and real execution remain out of scope.
 */
export function authorizeRuntimeAction(
  input: RuntimeAuthorizationInput,
  context: TrustedRuntimeAuthorizationContext,
): RuntimeAuthorizationResult {
  const parsed = RuntimeAuthorizationInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      outcome: "blocked",
      reason: { type: "input_invalid", reason: "schema_validation_failed" },
    };
  }
  const validatedInput = parsed.data;

  const parsedContext = TrustedRuntimeAuthorizationContextSchema.safeParse(context);
  if (!parsedContext.success) {
    return {
      outcome: "blocked",
      reason: {
        type: "runtime_authorization_context_invalid",
        reason: "schema_validation_failed",
      },
    };
  }
  const validatedContext = parsedContext.data;

  const runtimeEvidenceBlock = validateRuntimeEvidence(validatedInput, validatedContext);
  if (runtimeEvidenceBlock) {
    return runtimeEvidenceBlock;
  }

  const callContext = validateCallContext(validatedInput);
  if ("outcome" in callContext) {
    return callContext;
  }

  switch (validatedInput.action.type) {
    case "tool_call":
      return authorizeToolCall(validatedInput, validatedInput.action);
    case "agent_call":
      return authorizeAgentCall(
        validatedInput,
        validatedInput.action,
        callContext,
        validatedContext,
      );
  }
}

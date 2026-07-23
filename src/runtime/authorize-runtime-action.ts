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
  CallGraphEdgeApprovalEvidencePayload,
  LifecycleEvidenceRole,
  RunContextEvidencePayload,
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
  RUNTIME_ATTESTATION_DOMAIN_BY_EVIDENCE_KIND,
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

  if (
    !verifyEd25519Attestation(
      RUNTIME_ATTESTATION_DOMAIN_BY_EVIDENCE_KIND[evidenceKind],
      payload,
      envelope,
      trustedKey,
    )
  ) {
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

function validateRunContextFreshness(
  payload: RunContextEvidencePayload,
  context: TrustedRuntimeAuthorizationContext,
): RuntimeAuthorizationResult | undefined {
  const assertedAtEpochMs = Date.parse(payload.assertedAt);
  const authorizationTimeEpochMs = Date.parse(context.authorizationTime);

  if (authorizationTimeEpochMs < assertedAtEpochMs) {
    return {
      outcome: "blocked",
      reason: { type: "run_context_not_fresh", condition: "from_future" },
    };
  }

  const expiresAtEpochMs = assertedAtEpochMs + payload.freshnessTtl * 1_000;
  if (authorizationTimeEpochMs >= expiresAtEpochMs) {
    return {
      outcome: "blocked",
      reason: { type: "run_context_not_fresh", condition: "expired" },
    };
  }

  return undefined;
}

function validateRunContextEvidence(
  input: RuntimeAuthorizationInput,
  context: TrustedRuntimeAuthorizationContext,
): RunContextEvidencePayload | RuntimeAuthorizationResult {
  const evidence = input.runContextEvidence;
  const attestationBlock = validateAttestation(
    "run_context",
    evidence.payload,
    evidence.attestation,
    context,
  );
  if (attestationBlock) {
    return attestationBlock;
  }

  const recomputedContentHash = recomputeSpecContentHash(input.spec);
  if (
    evidence.payload.specId !== input.spec.specId ||
    evidence.payload.version !== input.spec.version ||
    evidence.payload.contentHash !== input.spec.contentHash ||
    evidence.payload.contentHash !== recomputedContentHash
  ) {
    return {
      outcome: "blocked",
      reason: {
        type: "run_context_subject_mismatch",
        specId: input.spec.specId,
        version: input.spec.version,
      },
    };
  }

  const freshnessBlock = validateRunContextFreshness(evidence.payload, context);
  if (freshnessBlock) {
    return freshnessBlock;
  }

  const { callContext, currentRunId } = evidence.payload;
  if (callContext.callChain.at(-1) !== evidence.payload.specId) {
    return {
      outcome: "blocked",
      reason: { type: "run_context_invalid", condition: "call_chain_tail_mismatch" },
    };
  }

  if ((callContext.parentRunId === null) !== (currentRunId === callContext.rootRunId)) {
    return {
      outcome: "blocked",
      reason: { type: "run_context_invalid", condition: "root_parent_relation_invalid" },
    };
  }

  if (callContext.parentRunId !== null && callContext.parentRunId === currentRunId) {
    return {
      outcome: "blocked",
      reason: { type: "run_context_invalid", condition: "parent_equals_current" },
    };
  }

  return evidence.payload;
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
    const edge = approvalEvidence.payload.approval.edge;
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

function validateCallGraphEdgeApprovalAuthority(
  payload: CallGraphEdgeApprovalEvidencePayload,
  context: TrustedRuntimeAuthorizationContext,
): RuntimeAuthorizationResult | undefined {
  const decidedAtEpochMs = Date.parse(payload.approval.decidedAt);
  const assertedAtEpochMs = Date.parse(payload.assertedAt);

  if (decidedAtEpochMs > assertedAtEpochMs) {
    return {
      outcome: "blocked",
      reason: {
        type: "call_graph_edge_approval_invalid",
        condition: "decision_after_assertion",
        artifactId: payload.approval.artifactId,
      },
    };
  }

  const authorizationTimeEpochMs = Date.parse(context.authorizationTime);
  if (authorizationTimeEpochMs < assertedAtEpochMs) {
    return {
      outcome: "blocked",
      reason: {
        type: "call_graph_edge_approval_not_fresh",
        condition: "from_future",
        artifactId: payload.approval.artifactId,
      },
    };
  }

  const freshUntilEpochMs = assertedAtEpochMs + payload.freshnessTtl * 1_000;
  if (authorizationTimeEpochMs >= freshUntilEpochMs) {
    return {
      outcome: "blocked",
      reason: {
        type: "call_graph_edge_approval_not_fresh",
        condition: "expired",
        artifactId: payload.approval.artifactId,
      },
    };
  }

  return undefined;
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
  currentRunId: string,
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
      approvalEvidence.payload,
      approvalEvidence.attestation,
      context,
    );
    if (attestationBlock) {
      return attestationBlock;
    }

    const authorityBlock = validateCallGraphEdgeApprovalAuthority(
      approvalEvidence.payload,
      context,
    );
    if (authorityBlock) {
      return authorityBlock;
    }
  }

  const approvedEdges = relevantApprovalEvidence
    .filter((approvalEvidence) => approvalEvidence.payload.approval.decision === "approved")
    .map((approvalEvidence) => approvalEvidence.payload.approval.edge);
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
    childRunContextDraft: {
      calleeSpecId: action.calleeSpecId,
      calleeVersionOrChannel: action.calleeVersionOrChannel,
      callContext: deriveNextCallContext(
        callContext,
        action,
        declaredCall.maxDepth,
        edge.maxDepth,
        currentRunId,
      ),
    },
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
 *   call-graph edge approval artifacts with a maximum 300-second authority
 *   lease. Every selected artifact is verified, checked for decision/assertion
 *   causality, and checked for freshness before decision fields are used.
 * - Run context, run identity, cycle chain, and remaining budgets are carried
 *   only by signed, content-bound evidence with a maximum 300-second freshness
 *   window. An allowed agent call returns an unsigned child-context draft for
 *   an external trusted resolver and signer; this Harness never mints runtime
 *   authority.
 * - Context attestation proves origin and integrity of presented claims, not
 *   parent spend consumption, single-use semantics, parent-child issuance, or
 *   current run identity. Sibling and nonce replay require a later runtime
 *   store or parent-decision linkage.
 * - Edge approval leases limit replay but do not prove that an artifact is the
 *   latest canonical decision, remains unrevoked inside the lease window, or
 *   is single-use. decidedAt stays audit history and never starts the lease.
 *   A stale relevant rejected artifact blocks fail-closed, allowing presenter
 *   self-denial but no privilege escalation; rejection is not revocation.
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

  const runContext = validateRunContextEvidence(validatedInput, validatedContext);
  if ("outcome" in runContext) {
    return runContext;
  }

  switch (validatedInput.action.type) {
    case "tool_call":
      return authorizeToolCall(validatedInput, validatedInput.action);
    case "agent_call":
      return authorizeAgentCall(
        validatedInput,
        validatedInput.action,
        runContext.callContext,
        runContext.currentRunId,
        validatedContext,
      );
  }
}

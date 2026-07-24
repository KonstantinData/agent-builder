import { computeContentHash } from "../assembler/content-hash.js";
import { detectCycleInChain } from "../invariants/cycle-detection.js";
import type {
  AgentSpecContent,
  ResolvedAgentCall,
} from "../schema/agent-spec-content.js";
import type { CallContext } from "../schema/call-context.js";
import type { AgentCallPolicyEdge } from "../schema/agent-call-policy-edge.js";
import {
  AgentCallAuthorizationReservationResultV1Schema,
  AgentCallAuthorizationReservationRequestV1Schema,
  AgentCallAuthorizationReservationTimeoutPolicySchema,
  type AgentCallAuthorizationReservationBindingV1,
  type AgentCallAuthorizationReservationRequestV1,
  type AgentCallAuthorizationReservationTimeoutPolicy,
  type LocalAuthorizationReservationReceipt,
} from "../schema/agent-call-authorization-reservation.js";
import type { RuntimeBindingArtifact } from "../schema/runtime-binding.js";
import { Rfc3339WithOffsetSchema } from "../schema/runtime-binding-validity.js";
import {
  CanonicalAuthorityLookupTimeoutPolicySchema,
  CanonicalAuthorityLookupResultV1Schema,
  type CanonicalAuthorityLookupRequestV1,
  type CanonicalAuthorityLookupResultV1,
  type CanonicalAuthorityLookupTimeoutPolicy,
  type EdgeSubjectV1,
} from "../schema/canonical-edge-authority.js";
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
  AuthorizedChildRunContextDraft,
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
import {
  canonicalCallGraphEdgeApprovalDecisionJson,
  computeCallGraphEdgeApprovalDecisionDigest,
} from "./edge-approval-digest.js";
import {
  computeAgentCallAuthorizationReservationId,
  computeAgentCallReservationActionDigest,
  computeAgentCallReservationDraftDigest,
  computeAgentCallReservationRunContextDigest,
} from "./agent-call-reservation-digest.js";

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

function leaseExpiryEpochMs(assertedAt: string, ttlSeconds: number): number {
  return Date.parse(assertedAt) + ttlSeconds * 1_000;
}

function deriveAuthorizationValidUntilExclusive(
  input: RuntimeAuthorizationInput,
  runContext: RunContextEvidencePayload,
  canonicalApprovalEvidence: ReadonlyArray<AttestedCallGraphEdgeApproval>,
): string | undefined {
  const binding = input.runtimeBindingEvidence?.payload;
  const calleeLifecycle = input.calleeLifecycleEvidence?.payload;
  if (
    binding === undefined ||
    calleeLifecycle === undefined ||
    canonicalApprovalEvidence.length === 0
  ) {
    return undefined;
  }

  const approvalFreshUntilEpochMs = Math.max(
    ...canonicalApprovalEvidence.map((evidence) =>
      leaseExpiryEpochMs(evidence.payload.assertedAt, evidence.payload.freshnessTtl),
    ),
  );
  const validUntilEpochMs = Math.min(
    leaseExpiryEpochMs(binding.deployedAt, binding.ttl),
    leaseExpiryEpochMs(
      input.actingLifecycleEvidence.payload.assertedAt,
      input.actingLifecycleEvidence.payload.freshnessTtl,
    ),
    leaseExpiryEpochMs(runContext.assertedAt, runContext.freshnessTtl),
    approvalFreshUntilEpochMs,
    leaseExpiryEpochMs(calleeLifecycle.assertedAt, calleeLifecycle.freshnessTtl),
  );

  try {
    const rendered = new Date(validUntilEpochMs).toISOString();
    return Rfc3339WithOffsetSchema.safeParse(rendered).success ? rendered : undefined;
  } catch {
    return undefined;
  }
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

interface AgentCallAuthorizationContinuation {
  readonly input: RuntimeAuthorizationInput;
  readonly action: AgentCallRuntimeAction;
  readonly declaredCall: ResolvedAgentCall;
  readonly callContext: CallContext;
  readonly currentRunId: string;
  readonly runContextEvidencePayload: RunContextEvidencePayload;
  readonly context: TrustedRuntimeAuthorizationContext;
  readonly approvedEvidence: ReadonlyArray<AttestedCallGraphEdgeApproval>;
}

type AgentCallAuthorizationPlan =
  | { readonly kind: "terminal"; readonly result: RuntimeAuthorizationResult }
  | {
      readonly kind: "lookup_required";
      readonly request: CanonicalAuthorityLookupRequestV1;
      readonly continuation: AgentCallAuthorizationContinuation;
    };

interface AgentCallAuthorizationReservationPlan {
  readonly kind: "reservation_required";
  readonly request: AgentCallAuthorizationReservationRequestV1;
  readonly childRunContextDraft: AuthorizedChildRunContextDraft;
}

type AgentCallPostLookupPlan = RuntimeAuthorizationResult | AgentCallAuthorizationReservationPlan;

function edgeSubjectFromAgentCall(
  input: RuntimeAuthorizationInput,
  action: AgentCallRuntimeAction,
): EdgeSubjectV1 {
  return {
    callerSpecId: input.spec.specId,
    callerVersion: input.spec.version,
    calleeSpecId: action.calleeSpecId,
    calleeVersionOrChannel: action.calleeVersionOrChannel,
    trustDomainId: input.spec.trustDomainId,
  };
}

function edgeSubjectsEqual(left: EdgeSubjectV1, right: EdgeSubjectV1): boolean {
  return (
    left.callerSpecId === right.callerSpecId &&
    left.callerVersion === right.callerVersion &&
    left.calleeSpecId === right.calleeSpecId &&
    left.calleeVersionOrChannel === right.calleeVersionOrChannel &&
    left.trustDomainId === right.trustDomainId
  );
}

function planAgentCallAuthorization(
  input: RuntimeAuthorizationInput,
  action: AgentCallRuntimeAction,
  callContext: CallContext,
  currentRunId: string,
  runContextEvidencePayload: RunContextEvidencePayload,
  context: TrustedRuntimeAuthorizationContext,
): AgentCallAuthorizationPlan {
  const declaredCall = input.spec.declaredAgentCalls.find(
    (call) =>
      call.calleeSpecId === action.calleeSpecId &&
      call.calleeVersionOrChannel === action.calleeVersionOrChannel,
  );
  if (!declaredCall) {
    return {
      kind: "terminal",
      result: {
        outcome: "blocked",
        reason: {
          type: "agent_call_not_declared",
          calleeSpecId: action.calleeSpecId,
          calleeVersionOrChannel: action.calleeVersionOrChannel,
        },
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
      return { kind: "terminal", result: attestationBlock };
    }

    const authorityBlock = validateCallGraphEdgeApprovalAuthority(
      approvalEvidence.payload,
      context,
    );
    if (authorityBlock) {
      return { kind: "terminal", result: authorityBlock };
    }
  }

  const approvedEvidence = relevantApprovalEvidence.filter(
    (approvalEvidence) => approvalEvidence.payload.approval.decision === "approved",
  );
  if (approvedEvidence.length === 0) {
    return {
      kind: "terminal",
      result: {
        outcome: "blocked",
        reason: {
          type: "call_edge_not_approved",
          calleeSpecId: action.calleeSpecId,
          calleeVersionOrChannel: action.calleeVersionOrChannel,
        },
      },
    };
  }

  return {
    kind: "lookup_required",
    request: {
      subject: edgeSubjectFromAgentCall(input, action),
      asOf: context.authorizationTime,
    },
    continuation: {
      input,
      action,
      declaredCall,
      callContext,
      currentRunId,
      runContextEvidencePayload,
      context,
      approvedEvidence,
    },
  };
}

function lookupResponseUntrustworthy(): RuntimeAuthorizationResult {
  return {
    outcome: "blocked",
    reason: {
      type: "approval_authority_lookup_unavailable",
      condition: "response_untrustworthy",
    },
  };
}

function validateLookupResultBinding(
  request: CanonicalAuthorityLookupRequestV1,
  result: CanonicalAuthorityLookupResultV1,
): RuntimeAuthorizationResult | undefined {
  if (result.kind === "unavailable") {
    return undefined;
  }

  if (
    result.asOf !== request.asOf ||
    !edgeSubjectsEqual(result.subject, request.subject) ||
    Date.parse(result.observedAt) < Date.parse(request.asOf)
  ) {
    return lookupResponseUntrustworthy();
  }

  if (result.kind === "found" && !edgeSubjectsEqual(result.record.subject, request.subject)) {
    return lookupResponseUntrustworthy();
  }

  return undefined;
}

function resumeAgentCallAuthorization(
  request: CanonicalAuthorityLookupRequestV1,
  continuation: AgentCallAuthorizationContinuation,
  rawLookupResult: unknown,
): AgentCallPostLookupPlan {
  const parsedLookupResult = CanonicalAuthorityLookupResultV1Schema.safeParse(rawLookupResult);
  if (!parsedLookupResult.success) {
    return lookupResponseUntrustworthy();
  }
  const lookupResult = parsedLookupResult.data;

  const bindingBlock = validateLookupResultBinding(request, lookupResult);
  if (bindingBlock) {
    return bindingBlock;
  }

  if (lookupResult.kind === "unavailable") {
    return {
      outcome: "blocked",
      reason: {
        type: "approval_authority_lookup_unavailable",
        condition: lookupResult.condition,
      },
    };
  }

  if (lookupResult.kind === "subject_absent") {
    return {
      outcome: "blocked",
      reason: {
        type: "call_graph_edge_approval_not_current",
        condition: "subject_absent",
      },
    };
  }

  const matchingEvidence = continuation.approvedEvidence.filter(
    (approvalEvidence) =>
      computeCallGraphEdgeApprovalDecisionDigest(approvalEvidence.payload.approval) ===
      lookupResult.record.approvalDigest,
  );

  if (matchingEvidence.length === 0) {
    return {
      outcome: "blocked",
      reason: {
        type: "call_graph_edge_approval_not_current",
        condition: "authority_superseded",
      },
    };
  }

  if (lookupResult.record.status === "revoked") {
    return {
      outcome: "blocked",
      reason: { type: "call_graph_edge_approval_revoked" },
    };
  }

  const evidenceByCanonicalDecision = new Map<string, AttestedCallGraphEdgeApproval>();
  for (const approvalEvidence of matchingEvidence) {
    const canonicalDecision = canonicalCallGraphEdgeApprovalDecisionJson(
      approvalEvidence.payload.approval,
    );
    evidenceByCanonicalDecision.set(canonicalDecision, approvalEvidence);
  }

  if (evidenceByCanonicalDecision.size > 1) {
    return {
      outcome: "blocked",
      reason: {
        type: "ambiguous_call_edge_approval",
        calleeSpecId: continuation.action.calleeSpecId,
        calleeVersionOrChannel: continuation.action.calleeVersionOrChannel,
      },
    };
  }

  const selectedEvidence = evidenceByCanonicalDecision.values().next().value;
  if (selectedEvidence === undefined) {
    return lookupResponseUntrustworthy();
  }

  const { input, action, declaredCall, callContext, currentRunId, context } = continuation;
  const edge = selectedEvidence.payload.approval.edge as AgentCallPolicyEdge;

  if (edge.requiresHumanGate) {
    return {
      outcome: "blocked",
      reason: {
        type: "human_gate_required",
        calleeSpecId: action.calleeSpecId,
        calleeVersionOrChannel: action.calleeVersionOrChannel,
      },
    };
  }

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

  const childRunContextDraft: AuthorizedChildRunContextDraft = {
    calleeSpecId: action.calleeSpecId,
    calleeVersionOrChannel: action.calleeVersionOrChannel,
    callContext: deriveNextCallContext(
      callContext,
      action,
      declaredCall.maxDepth,
      edge.maxDepth,
      currentRunId,
    ),
  };
  const authorizationValidUntilExclusive = deriveAuthorizationValidUntilExclusive(
    input,
    continuation.runContextEvidencePayload,
    matchingEvidence,
  );
  if (authorizationValidUntilExclusive === undefined) {
    return {
      outcome: "blocked",
      reason: { type: "input_invalid", reason: "reservation_deadline_derivation_failed" },
    };
  }

  const binding: AgentCallAuthorizationReservationBindingV1 = {
    subject: request.subject,
    expectedAuthorityRevision: lookupResult.record.authorityRevision,
    expectedApprovalDigest: lookupResult.record.approvalDigest,
    currentRunId,
    runContextDigest: computeAgentCallReservationRunContextDigest(
      continuation.runContextEvidencePayload,
    ),
    actionDigest: computeAgentCallReservationActionDigest(action),
    childRunContextDraftDigest: computeAgentCallReservationDraftDigest(childRunContextDraft),
    authorizationTime: request.asOf,
    authorizationValidUntilExclusive,
  };
  const parsedReservationRequest = AgentCallAuthorizationReservationRequestV1Schema.parse({
    reservationId: computeAgentCallAuthorizationReservationId(binding),
    ...binding,
  });
  const reservationRequest = Object.freeze({
    ...parsedReservationRequest,
    subject: Object.freeze({ ...parsedReservationRequest.subject }),
  });

  return {
    kind: "reservation_required",
    request: reservationRequest,
    childRunContextDraft,
  };
}

function reservationIndeterminate(
  condition: "timeout" | "adapter_error" | "store_error" | "response_untrustworthy",
): RuntimeAuthorizationResult {
  return {
    outcome: "blocked",
    reason: {
      type: "agent_call_authorization_reservation_indeterminate",
      condition,
    },
  };
}

function receiptMatchesReservationRequest(
  receipt: LocalAuthorizationReservationReceipt,
  request: AgentCallAuthorizationReservationRequestV1,
): boolean {
  const {
    reservationId: _ignoredReservationId,
    ...binding
  } = request;
  return (
    request.reservationId === computeAgentCallAuthorizationReservationId(binding) &&
    receipt.reservationId === request.reservationId &&
    edgeSubjectsEqual(receipt.subject, request.subject) &&
    receipt.expectedAuthorityRevision === request.expectedAuthorityRevision &&
    receipt.expectedApprovalDigest === request.expectedApprovalDigest &&
    receipt.currentRunId === request.currentRunId &&
    receipt.runContextDigest === request.runContextDigest &&
    receipt.actionDigest === request.actionDigest &&
    receipt.childRunContextDraftDigest === request.childRunContextDraftDigest &&
    receipt.authorizationTime === request.authorizationTime &&
    receipt.authorizationValidUntilExclusive === request.authorizationValidUntilExclusive &&
    Date.parse(receipt.reservedAt) >= Date.parse(request.authorizationTime) &&
    Date.parse(receipt.reservedAt) < Date.parse(request.authorizationValidUntilExclusive)
  );
}

function resumeAgentCallAuthorizationReservation(
  plan: AgentCallAuthorizationReservationPlan,
  rawReservationResult: unknown,
): RuntimeAuthorizationResult {
  const parsedResult = AgentCallAuthorizationReservationResultV1Schema.safeParse(
    rawReservationResult,
  );
  if (!parsedResult.success) {
    return reservationIndeterminate("response_untrustworthy");
  }
  const result = parsedResult.data;

  if (result.kind === "unavailable") {
    return reservationIndeterminate("store_error");
  }

  if (result.kind === "reserved" || result.kind === "already_reserved") {
    if (!receiptMatchesReservationRequest(result.receipt, plan.request)) {
      return reservationIndeterminate("response_untrustworthy");
    }
    return {
      outcome: "allowed",
      actionType: "agent_call",
      childRunContextDraft: plan.childRunContextDraft,
      localAuthorizationReservationReceipt: result.receipt,
    };
  }

  const observedAtEpochMs = Date.parse(result.observedAt);
  const authorizationTimeEpochMs = Date.parse(plan.request.authorizationTime);
  if (observedAtEpochMs < authorizationTimeEpochMs) {
    return reservationIndeterminate("response_untrustworthy");
  }

  if (result.kind === "subject_absent") {
    return {
      outcome: "blocked",
      reason: {
        type: "agent_call_authorization_reservation_not_current",
        condition: "subject_absent",
      },
    };
  }

  if (result.kind === "authority_revoked") {
    if (result.currentAuthorityRevision <= plan.request.expectedAuthorityRevision) {
      return reservationIndeterminate("response_untrustworthy");
    }
    return {
      outcome: "blocked",
      reason: { type: "agent_call_authorization_reservation_revoked" },
    };
  }

  if (result.kind === "authority_superseded") {
    if (result.currentAuthorityRevision <= plan.request.expectedAuthorityRevision) {
      return reservationIndeterminate("response_untrustworthy");
    }
    return {
      outcome: "blocked",
      reason: {
        type: "agent_call_authorization_reservation_not_current",
        condition: "authority_superseded",
      },
    };
  }

  if (
    observedAtEpochMs < Date.parse(plan.request.authorizationValidUntilExclusive)
  ) {
    return reservationIndeterminate("response_untrustworthy");
  }
  return {
    outcome: "blocked",
    reason: { type: "agent_call_authorization_reservation_window_expired" },
  };
}

/**
 * Data Plane Runtime Harness v0.1. This is an authorization, reservation, and
 * context-derivation layer only: it never executes tools or agents. Agent-call
 * authorization performs one read-only canonical-authority admission lookup
 * after every relevant Step-13 approval check, then delegates exactly one
 * atomic local reservation after every remaining pure guard succeeds. It makes
 * no other network, memory, registry, DB, deployment, or human-gate mutation.
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
 *   window. An allowed agent call returns an unsigned child-context draft and a
 *   host/store-local reservation receipt. An external trusted resolver and
 *   signer must still assign child identity and runtime authority.
 * - Context attestation proves origin and integrity of presented claims, not
 *   parent spend consumption, parent-child issuance, or current run identity.
 *   The reservation is single only as a logical local authorization binding;
 *   sibling spend-down and execution replay require later boundaries.
 * - A host-bound point-in-time resolver proves canonical edge authority as of
 *   the same trusted authorization instant used by every lease check. decidedAt
 *   stays audit history and never starts the lease.
 *   A stale relevant rejected artifact blocks fail-closed, allowing presenter
 *   self-denial but no privilege escalation; rejection is not revocation.
 * - The host-bound reservation adapter must atomically compare canonical
 *   authority and insert the reservation. Its local receipt is not portable
 *   authority and proves neither dispatch nor at-most-once execution.
 * - External signing, private-key custody, KMS/HSM, key revocation,
 *   parent-budget consumption, sibling replay, synchronous lifecycle lookup,
 *   process liveness, channel resolution, and real execution remain out of scope.
 */
export type CanonicalEdgeAuthorityResolver = (
  request: CanonicalAuthorityLookupRequestV1,
) => Promise<unknown>;

export type AgentCallAuthorizationReservationAdapter = (
  request: AgentCallAuthorizationReservationRequestV1,
) => Promise<unknown>;

export interface RuntimeAuthorizerConfig {
  readonly canonicalAuthorityResolver: CanonicalEdgeAuthorityResolver;
  readonly timeoutPolicy: CanonicalAuthorityLookupTimeoutPolicy;
  readonly authorizationReservationAdapter: AgentCallAuthorizationReservationAdapter;
  readonly authorizationReservationTimeoutPolicy: AgentCallAuthorizationReservationTimeoutPolicy;
}

export interface RuntimeAuthorizer {
  readonly authorizeRuntimeAction: (
    input: RuntimeAuthorizationInput,
    context: TrustedRuntimeAuthorizationContext,
  ) => Promise<RuntimeAuthorizationResult>;
}

class CanonicalAuthorityLookupTimeoutError extends Error {}
class AgentCallAuthorizationReservationTimeoutError extends Error {}

async function resolveCanonicalAuthority(
  resolver: CanonicalEdgeAuthorityResolver,
  request: CanonicalAuthorityLookupRequestV1,
  timeoutMs: number,
): Promise<unknown> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new CanonicalAuthorityLookupTimeoutError("canonical authority lookup timed out")),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([Promise.resolve().then(() => resolver(request)), timeout]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function reserveAgentCallAuthorization(
  adapter: AgentCallAuthorizationReservationAdapter,
  request: AgentCallAuthorizationReservationRequestV1,
  timeoutMs: number,
): Promise<unknown> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(
      () =>
        reject(
          new AgentCallAuthorizationReservationTimeoutError(
            "agent-call authorization reservation timed out",
          ),
        ),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([Promise.resolve().then(() => adapter(request)), timeout]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}

export function createRuntimeAuthorizer(config: RuntimeAuthorizerConfig): RuntimeAuthorizer {
  if (typeof config.canonicalAuthorityResolver !== "function") {
    throw new TypeError("canonicalAuthorityResolver must be a function");
  }
  const parsedTimeoutPolicy = CanonicalAuthorityLookupTimeoutPolicySchema.safeParse(
    config.timeoutPolicy,
  );
  if (!parsedTimeoutPolicy.success) {
    throw new TypeError("timeoutPolicy must contain a valid positive timeoutMs");
  }

  if (typeof config.authorizationReservationAdapter !== "function") {
    throw new TypeError("authorizationReservationAdapter must be a function");
  }
  const parsedReservationTimeoutPolicy =
    AgentCallAuthorizationReservationTimeoutPolicySchema.safeParse(
      config.authorizationReservationTimeoutPolicy,
    );
  if (!parsedReservationTimeoutPolicy.success) {
    throw new TypeError(
      "authorizationReservationTimeoutPolicy must contain a valid positive timeoutMs",
    );
  }

  const resolver = config.canonicalAuthorityResolver;
  const timeoutMs = parsedTimeoutPolicy.data.timeoutMs;
  const reservationAdapter = config.authorizationReservationAdapter;
  const reservationTimeoutMs = parsedReservationTimeoutPolicy.data.timeoutMs;

  return Object.freeze({
    authorizeRuntimeAction: async (
      input: RuntimeAuthorizationInput,
      context: TrustedRuntimeAuthorizationContext,
    ): Promise<RuntimeAuthorizationResult> => {
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

      if (validatedInput.action.type === "tool_call") {
        return authorizeToolCall(validatedInput, validatedInput.action);
      }

      const plan = planAgentCallAuthorization(
        validatedInput,
        validatedInput.action,
        runContext.callContext,
        runContext.currentRunId,
        runContext,
        validatedContext,
      );
      if (plan.kind === "terminal") {
        return plan.result;
      }

      let rawLookupResult: unknown;
      try {
        rawLookupResult = await resolveCanonicalAuthority(
          resolver,
          plan.request,
          timeoutMs,
        );
      } catch (error) {
        return {
          outcome: "blocked",
          reason: {
            type: "approval_authority_lookup_unavailable",
            condition:
              error instanceof CanonicalAuthorityLookupTimeoutError
                ? "timeout"
                : "resolver_error",
          },
        };
      }

      const postLookupPlan = resumeAgentCallAuthorization(
        plan.request,
        plan.continuation,
        rawLookupResult,
      );
      if ("outcome" in postLookupPlan) {
        return postLookupPlan;
      }

      let rawReservationResult: unknown;
      try {
        rawReservationResult = await reserveAgentCallAuthorization(
          reservationAdapter,
          postLookupPlan.request,
          reservationTimeoutMs,
        );
      } catch (error) {
        return reservationIndeterminate(
          error instanceof AgentCallAuthorizationReservationTimeoutError
            ? "timeout"
            : "adapter_error",
        );
      }

      return resumeAgentCallAuthorizationReservation(
        postLookupPlan,
        rawReservationResult,
      );
    },
  });
}

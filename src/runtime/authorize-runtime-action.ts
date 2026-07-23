import { detectCycleInChain } from "../invariants/cycle-detection.js";
import type { DeploymentBinding } from "../schema/agent-spec-runtime-metadata.js";
import type { CallContext } from "../schema/call-context.js";
import type { AgentCallPolicyEdge } from "../schema/agent-call-policy-edge.js";
import type { ApprovalArtifact } from "../schema/approval-artifact.js";
import type {
  AgentCallRuntimeAction,
  CalleeLifecycleEvidence,
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

export const RUNTIME_EXECUTABLE_STATES = ["deployed"] as const;

/**
 * Callee callability is intentionally modeled separately from caller
 * executability. The state sets are currently identical, but the concepts and
 * future policy evolution are distinct.
 */
export const CALLEE_CALLABLE_STATES = ["deployed"] as const;
type CallGraphEdgeApproval = Extract<ApprovalArtifact, { readonly type: "call_graph_edge" }>;

function isApprovedCallGraphEdgeApproval(
  approval: ApprovalArtifact,
): approval is CallGraphEdgeApproval & { readonly decision: "approved" } {
  return approval.type === "call_graph_edge" && approval.decision === "approved";
}

function isExecutableState(state: string): boolean {
  return RUNTIME_EXECUTABLE_STATES.some((executableState) => executableState === state);
}

function isCallableState(state: string): boolean {
  return CALLEE_CALLABLE_STATES.some((callableState) => callableState === state);
}

function validateRuntimeBindingValidity(
  binding: DeploymentBinding,
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

function validateRuntimeSubject(
  input: RuntimeAuthorizationInput,
  context: TrustedRuntimeAuthorizationContext,
): RuntimeAuthorizationResult | undefined {
  if (!isExecutableState(input.metadata.state)) {
    return {
      outcome: "blocked",
      reason: { type: "runtime_state_not_executable", state: input.metadata.state },
    };
  }

  if (input.metadata.specId !== input.spec.specId || input.metadata.version !== input.spec.version) {
    return {
      outcome: "blocked",
      reason: {
        type: "runtime_subject_mismatch",
        specId: input.spec.specId,
        version: input.spec.version,
      },
    };
  }

  if (input.metadata.deploymentBinding === undefined) {
    return {
      outcome: "blocked",
      reason: {
        type: "runtime_binding_missing",
        specId: input.spec.specId,
        version: input.spec.version,
      },
    };
  }

  if (input.metadata.deploymentBinding.contentHash !== input.spec.contentHash) {
    return {
      outcome: "blocked",
      reason: {
        type: "runtime_binding_content_hash_mismatch",
        specId: input.spec.specId,
        version: input.spec.version,
      },
    };
  }

  return validateRuntimeBindingValidity(input.metadata.deploymentBinding, context);
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

function findApprovedEdges(
  input: RuntimeAuthorizationInput,
  action: AgentCallRuntimeAction,
): AgentCallPolicyEdge[] {
  const matches: AgentCallPolicyEdge[] = [];
  for (const approval of input.edgeApprovals) {
    if (!isApprovedCallGraphEdgeApproval(approval)) {
      continue;
    }
    const edge = approval.edge;
    const matchesEdge =
      edge.callerSpecId === input.spec.specId &&
      edge.callerVersion === input.spec.version &&
      edge.calleeSpecId === action.calleeSpecId &&
      edge.calleeVersionOrChannel === action.calleeVersionOrChannel;
    if (matchesEdge) {
      matches.push(edge);
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
  evidence: CalleeLifecycleEvidence | undefined,
  action: AgentCallRuntimeAction,
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

  if (
    evidence.calleeSpecId !== action.calleeSpecId ||
    evidence.calleeVersionOrChannel !== action.calleeVersionOrChannel
  ) {
    return {
      outcome: "blocked",
      reason: {
        type: "callee_lifecycle_subject_mismatch",
        calleeSpecId: action.calleeSpecId,
        calleeVersionOrChannel: action.calleeVersionOrChannel,
      },
    };
  }

  if (!isCallableState(evidence.state)) {
    return {
      outcome: "blocked",
      reason: {
        type: "callee_state_not_callable",
        calleeSpecId: action.calleeSpecId,
        calleeVersionOrChannel: action.calleeVersionOrChannel,
        state: evidence.state,
      },
    };
  }

  return undefined;
}

function authorizeAgentCall(
  input: RuntimeAuthorizationInput,
  action: AgentCallRuntimeAction,
  callContext: CallContext,
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

  const edges = findApprovedEdges(input, action);
  if (edges.length === 0) {
    return {
      outcome: "blocked",
      reason: {
        type: "call_edge_not_approved",
        calleeSpecId: action.calleeSpecId,
        calleeVersionOrChannel: action.calleeVersionOrChannel,
      },
    };
  }

  if (edges.some((edge) => edge.requiresHumanGate)) {
    return {
      outcome: "blocked",
      reason: {
        type: "human_gate_required",
        calleeSpecId: action.calleeSpecId,
        calleeVersionOrChannel: action.calleeVersionOrChannel,
      },
    };
  }

  if (edges.length > 1) {
    return {
      outcome: "blocked",
      reason: {
        type: "ambiguous_call_edge_approval",
        calleeSpecId: action.calleeSpecId,
        calleeVersionOrChannel: action.calleeVersionOrChannel,
      },
    };
  }

  const edge = edges[0] as AgentCallPolicyEdge;

  if (!declaredCall.allowedIntents.includes(action.intent) || !edge.allowedIntents.includes(action.intent)) {
    return { outcome: "blocked", reason: { type: "call_intent_not_allowed", intent: action.intent } };
  }

  if (detectCycleInChain(callContext.callChain, action.calleeSpecId)) {
    return { outcome: "blocked", reason: { type: "cycle_detected", calleeSpecId: action.calleeSpecId } };
  }

  const calleeLifecycleBlock = validateCalleeLifecycleEvidence(
    input.calleeLifecycleEvidence,
    action,
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
 * - Runtime metadata is executable only in `deployed` state with a deployment
 *   binding whose contentHash matches the supplied immutable spec content.
 * - Temporal validity is evaluated over supplied control-plane-asserted binding
 *   evidence. This slice validates structure, subject binding, content hash,
 *   and temporal consistency, but does not authenticate the evidence's origin
 *   or integrity. A future attestation must cover the complete binding artifact.
 * - Parent context spend-down is caller-owned in v0.1. This function returns
 *   the authorized child context; it does not mutate or return the parent
 *   context for later sibling calls.
 * - Agent calls require exact-subject lifecycle evidence whose presented state
 *   is callable. The evidence is caller-supplied and not attested or fresh, so
 *   this validates structural consistency rather than current lifecycle truth.
 *   Process liveness and channel resolution remain out of scope.
 * - `currentRunId` is structurally validated but not attested against a runtime
 *   store; run identity attestation belongs to a later runtime binding slice.
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

  const subjectBlock = validateRuntimeSubject(validatedInput, validatedContext);
  if (subjectBlock) {
    return subjectBlock;
  }

  const callContext = validateCallContext(validatedInput);
  if ("outcome" in callContext) {
    return callContext;
  }

  switch (validatedInput.action.type) {
    case "tool_call":
      return authorizeToolCall(validatedInput, validatedInput.action);
    case "agent_call":
      return authorizeAgentCall(validatedInput, validatedInput.action, callContext);
  }
}

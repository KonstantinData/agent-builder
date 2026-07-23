import { detectCycleInChain } from "../invariants/cycle-detection.js";
import type { CallContext } from "../schema/call-context.js";
import type { AgentCallPolicyEdge } from "../schema/agent-call-policy-edge.js";
import type { ApprovalArtifact } from "../schema/approval-artifact.js";
import type {
  AgentCallRuntimeAction,
  RuntimeAuthorizationInput,
  RuntimeAuthorizationResult,
  ToolCallRuntimeAction,
} from "../schema/runtime-authorization.js";
import { RuntimeAuthorizationInputSchema } from "../schema/runtime-authorization.js";
import {
  isRuntimeBudgetMonotonic,
  remainingRuntimeBudgetFromContext,
} from "./runtime-budget.js";

export const RUNTIME_EXECUTABLE_STATES = ["deployed"] as const;
type CallGraphEdgeApproval = Extract<ApprovalArtifact, { readonly type: "call_graph_edge" }>;

function isApprovedCallGraphEdgeApproval(
  approval: ApprovalArtifact,
): approval is CallGraphEdgeApproval & { readonly decision: "approved" } {
  return approval.type === "call_graph_edge" && approval.decision === "approved";
}

function isExecutableState(state: string): boolean {
  return RUNTIME_EXECUTABLE_STATES.some((executableState) => executableState === state);
}

function validateRuntimeSubject(input: RuntimeAuthorizationInput): RuntimeAuthorizationResult | undefined {
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

  return undefined;
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
 * - Parent context spend-down is caller-owned in v0.1. This function returns
 *   the authorized child context; it does not mutate or return the parent
 *   context for later sibling calls.
 * - Callee liveness is not visible without callee metadata or a runtime store;
 *   this slice authorizes the call edge, not whether the callee is currently
 *   suspended/revoked/live.
 * - `currentRunId` is structurally validated but not attested against a runtime
 *   store; run identity attestation belongs to a later runtime binding slice.
 */
export function authorizeRuntimeAction(
  input: RuntimeAuthorizationInput,
): RuntimeAuthorizationResult {
  const parsed = RuntimeAuthorizationInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      outcome: "blocked",
      reason: { type: "input_invalid", reason: "schema_validation_failed" },
    };
  }
  const validatedInput = parsed.data;

  const subjectBlock = validateRuntimeSubject(validatedInput);
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

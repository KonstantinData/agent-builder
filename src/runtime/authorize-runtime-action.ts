import { detectCycleInChain } from "../invariants/cycle-detection.js";
import { CallContextSchema, type CallContext } from "../schema/call-context.js";
import type { AgentCallPolicyEdge } from "../schema/agent-call-policy-edge.js";
import type { ApprovalArtifact } from "../schema/approval-artifact.js";
import type {
  AgentCallRuntimeAction,
  RuntimeAuthorizationInput,
  RuntimeAuthorizationResult,
  ToolCallRuntimeAction,
} from "../schema/runtime-authorization.js";
import {
  isRuntimeBudgetMonotonic,
  remainingRuntimeBudgetFromContext,
} from "./runtime-budget.js";

export const RUNTIME_EXECUTABLE_STATES = ["approved"] as const;
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

  return undefined;
}

function validateCallContext(input: RuntimeAuthorizationInput): CallContext | RuntimeAuthorizationResult {
  const parsed = CallContextSchema.safeParse(input.callContext);
  if (!parsed.success) {
    return {
      outcome: "blocked",
      reason: { type: "call_context_invalid", reason: "schema_validation_failed" },
    };
  }

  const tail = parsed.data.callChain.at(-1);
  if (tail !== input.spec.specId) {
    return {
      outcome: "blocked",
      reason: { type: "call_context_invalid", reason: "acting_spec_not_call_chain_tail" },
    };
  }

  return parsed.data;
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

function findApprovedEdge(input: RuntimeAuthorizationInput, action: AgentCallRuntimeAction) {
  for (const approval of input.edgeApprovals) {
    if (!isApprovedCallGraphEdgeApproval(approval)) {
      continue;
    }
    const edge = approval.edge;
    const matches =
      edge.callerSpecId === input.spec.specId &&
      edge.callerVersion === input.spec.version &&
      edge.calleeSpecId === action.calleeSpecId &&
      edge.calleeVersionOrChannel === action.calleeVersionOrChannel;
    if (matches) {
      return edge;
    }
  }
  return undefined;
}

function deriveNextCallContext(
  callContext: CallContext,
  action: AgentCallRuntimeAction,
  currentRunId: string,
): CallContext {
  return {
    rootRunId: callContext.rootRunId,
    parentRunId: currentRunId,
    callChain: [...callContext.callChain, action.calleeSpecId],
    remainingDepth: callContext.remainingDepth - 1,
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

  const edge: AgentCallPolicyEdge | undefined = findApprovedEdge(input, action);
  if (!edge) {
    return {
      outcome: "blocked",
      reason: {
        type: "call_edge_not_approved",
        calleeSpecId: action.calleeSpecId,
        calleeVersionOrChannel: action.calleeVersionOrChannel,
      },
    };
  }

  if (!declaredCall.allowedIntents.includes(action.intent) || !edge.allowedIntents.includes(action.intent)) {
    return { outcome: "blocked", reason: { type: "call_intent_not_allowed", intent: action.intent } };
  }

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
    nextCallContext: deriveNextCallContext(callContext, action, input.currentRunId),
  };
}

/**
 * Data Plane Runtime Harness v0.1. This is an authorization and context
 * derivation layer only: it never executes tools, never touches network,
 * memory, registry, DB, deployment state, or human-gate decisions.
 *
 * Known v0.1 boundaries:
 * - Runtime metadata intentionally carries no contentHash, so this harness can
 *   bind spec <-> metadata only by specId/version. The gate remains the
 *   contentHash-bound approval point.
 * - Callee liveness is not visible without callee metadata or a runtime store;
 *   this slice authorizes the call edge, not whether the callee is currently
 *   suspended/revoked/live.
 */
export function authorizeRuntimeAction(
  input: RuntimeAuthorizationInput,
): RuntimeAuthorizationResult {
  const subjectBlock = validateRuntimeSubject(input);
  if (subjectBlock) {
    return subjectBlock;
  }

  const callContext = validateCallContext(input);
  if ("outcome" in callContext) {
    return callContext;
  }

  switch (input.action.type) {
    case "tool_call":
      return authorizeToolCall(input, input.action);
    case "agent_call":
      return authorizeAgentCall(input, input.action, callContext);
  }
}

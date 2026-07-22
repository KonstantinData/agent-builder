import type {
  AgentSpecContent,
  DeclaredTool,
  ResolvedAgentCall,
} from "../schema/agent-spec-content.js";
import type { Budget } from "../schema/common.js";

export type DeltaClassification = "capability-expanding" | "capability-reducing" | "neutral";
type DimensionDelta = "expand" | "reduce" | "same";

function stableParamsKey(params: Record<string, string | number | boolean>): string {
  return JSON.stringify(Object.keys(params).sort().map((key) => [key, params[key]]));
}

// Includes params in the key so any change to them (new/removed/altered) is
// treated as a different tool grant, not silently ignored (params may later
// carry operations, tables, fields, or scopes that are just as
// capability-relevant as `scope` itself).
function toolKey(tool: DeclaredTool): string {
  return `${tool.toolId}::${tool.scope}::${stableParamsKey(tool.params)}`;
}

function classifyToolsDelta(
  parent: readonly DeclaredTool[],
  child: readonly DeclaredTool[],
): DimensionDelta {
  const parentKeys = new Set(parent.map(toolKey));
  const childKeys = new Set(child.map(toolKey));

  const addsNewTool = [...childKeys].some((key) => !parentKeys.has(key));
  if (addsNewTool) {
    return "expand";
  }
  const dropsTool = [...parentKeys].some((key) => !childKeys.has(key));
  return dropsTool ? "reduce" : "same";
}

function callKey(call: ResolvedAgentCall): string {
  return `${call.calleeSpecId}::${call.calleeVersionOrChannel}`;
}

function classifyCallsDelta(
  parent: readonly ResolvedAgentCall[],
  child: readonly ResolvedAgentCall[],
): DimensionDelta {
  const parentByKey = new Map(parent.map((call) => [callKey(call), call]));
  const childByKey = new Map(child.map((call) => [callKey(call), call]));

  for (const [key, childCall] of childByKey) {
    const parentCall = parentByKey.get(key);
    if (!parentCall) {
      return "expand"; // brand new edge
    }
    const addsIntent = childCall.allowedIntents.some(
      (intent) => !parentCall.allowedIntents.includes(intent),
    );
    if (
      addsIntent ||
      childCall.maxDepth > parentCall.maxDepth ||
      childCall.maxCallsPerRun > parentCall.maxCallsPerRun
    ) {
      return "expand"; // same edge, widened intents or limits
    }
  }

  const dropsOrNarrowsEdge = [...parentByKey].some(([key, parentCall]) => {
    const childCall = childByKey.get(key);
    if (!childCall) {
      return true; // edge removed entirely
    }
    const dropsIntent = parentCall.allowedIntents.some(
      (intent) => !childCall.allowedIntents.includes(intent),
    );
    return (
      dropsIntent ||
      childCall.maxDepth < parentCall.maxDepth ||
      childCall.maxCallsPerRun < parentCall.maxCallsPerRun
    );
  });

  return dropsOrNarrowsEdge ? "reduce" : "same";
}

function classifyBudgetDelta(parent: Budget, child: Budget): DimensionDelta {
  const dimensions: Array<keyof Budget> = ["costCeiling", "maxIterations", "timeoutMs"];
  if (dimensions.some((dim) => child[dim] > parent[dim])) {
    return "expand";
  }
  return dimensions.some((dim) => child[dim] < parent[dim]) ? "reduce" : "same";
}

/**
 * Opaque scalar fields (memory scope, trust domain) cannot be proven "narrower"
 * from their text alone, so any change is conservatively treated as expanding
 * — consistent with the architecture doc's conservative default.
 */
function classifyScalarDelta(parent: string, child: string): DimensionDelta {
  return parent === child ? "same" : "expand";
}

/**
 * `declaredRoles` is a discovery property, not an ordered list — compared as a
 * set. Any difference (addition OR removal) counts conservatively as
 * "expand": classifyDelta cannot see the whole call graph and therefore
 * cannot prove a removed role has no other callers depending on it (same
 * conservative treatment as the opaque memoryScope/trustDomainId scalars).
 * This dimension can never produce "reduce", only "same" or "expand".
 */
function classifyRolesDelta(parent: readonly string[], child: readonly string[]): DimensionDelta {
  const parentSet = new Set(parent);
  const childSet = new Set(child);
  if (parentSet.size !== childSet.size) {
    return "expand";
  }
  return [...parentSet].every((role) => childSet.has(role)) ? "same" : "expand";
}

/**
 * Invariant 3: a single expanding dimension classifies the whole delta as
 * `capability-expanding`, regardless of how many other dimensions shrank in
 * the same version (Section 5 of the architecture doc).
 */
export function classifyDelta(parent: AgentSpecContent, child: AgentSpecContent): DeltaClassification {
  const dimensions: DimensionDelta[] = [
    classifyToolsDelta(parent.declaredTools, child.declaredTools),
    classifyCallsDelta(parent.declaredAgentCalls, child.declaredAgentCalls),
    classifyBudgetDelta(parent.resourceLimits, child.resourceLimits),
    classifyScalarDelta(parent.memoryScope, child.memoryScope),
    classifyScalarDelta(parent.trustDomainId, child.trustDomainId),
    classifyRolesDelta(parent.declaredRoles, child.declaredRoles),
  ];

  if (dimensions.includes("expand")) {
    return "capability-expanding";
  }
  return dimensions.every((dimension) => dimension === "same") ? "neutral" : "capability-reducing";
}

import type { SpecId } from "../schema/common.js";
import type { AgentCallPolicyEdge } from "../schema/agent-call-policy-edge.js";

/**
 * Invariant 4a: runtime cycle rejection. Rejects a call if `calleeId` already
 * appears anywhere in the current call chain, independent of any individual
 * edge's `maxDepth` — a per-edge depth limit alone cannot stop a cycle that
 * spans several different edges (A -> B -> C -> A).
 */
export function detectCycleInChain(callChain: readonly SpecId[], calleeId: SpecId): boolean {
  return callChain.includes(calleeId);
}

/**
 * Invariant 4b: graph-level cycle check at edge-approval time (Section 8).
 * Runs a reachability search from the candidate's callee to see whether the
 * candidate's caller is reachable — if so, approving this edge would close a
 * cycle across the existing, already-approved graph.
 */
export function wouldCreateGraphCycle(
  existingEdges: readonly AgentCallPolicyEdge[],
  candidate: Pick<AgentCallPolicyEdge, "callerSpecId" | "calleeSpecId">,
): boolean {
  if (candidate.callerSpecId === candidate.calleeSpecId) {
    return true;
  }

  const adjacency = new Map<SpecId, SpecId[]>();
  for (const edge of existingEdges) {
    const targets = adjacency.get(edge.callerSpecId) ?? [];
    targets.push(edge.calleeSpecId);
    adjacency.set(edge.callerSpecId, targets);
  }

  const visited = new Set<SpecId>();
  const stack: SpecId[] = [candidate.calleeSpecId];
  while (stack.length > 0) {
    const current = stack.pop() as SpecId;
    if (current === candidate.callerSpecId) {
      return true;
    }
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    stack.push(...(adjacency.get(current) ?? []));
  }
  return false;
}

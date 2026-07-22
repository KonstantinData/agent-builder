import type { AgentSpecContent } from "../schema/agent-spec-content.js";
import type { ToolId } from "../schema/common.js";
import type { PolicyRejectionReason } from "./harness-types.js";

/**
 * Injected combinations (Step 4 decision), not hardcoded. A combination is
 * violated when the candidate's declared tools are a superset of it. Entries
 * of length 0 are ignored — `[].every(...)` is vacuously true and would
 * otherwise flag every candidate as violating a degenerate empty combination.
 */
export function checkForbiddenToolCombinations(
  candidate: AgentSpecContent,
  forbiddenToolCombinations: readonly (readonly ToolId[])[],
): PolicyRejectionReason[] {
  const declaredIds = new Set(candidate.declaredTools.map((tool) => tool.toolId));
  const reasons: PolicyRejectionReason[] = [];
  for (const combination of forbiddenToolCombinations) {
    if (combination.length === 0) {
      continue;
    }
    const violated = combination.every((toolId) => declaredIds.has(toolId));
    if (violated) {
      reasons.push({ type: "forbidden_tool_combination", toolIds: combination });
    }
  }
  return reasons;
}

import type { AgentSpecContent } from "../schema/agent-spec-content.js";
import type { SpecId } from "../schema/common.js";
import { pickHighestVersion } from "./version-assignment.js";

export type RoleResolution =
  | { readonly outcome: "resolved"; readonly spec: AgentSpecContent }
  | { readonly outcome: "unresolved" }
  | { readonly outcome: "ambiguous"; readonly matchingSpecIds: readonly SpecId[] };

/**
 * `declaredRoles` is a discovery property on approved spec content (not a
 * runtime permission). Grouping is by `specId`, not `specId`+version: several
 * versions of the *same* spec matching a role is not ambiguous — the highest
 * version is picked deterministically. Only more than one *distinct* specId
 * matching the same role is ambiguous.
 */
export function resolveCalleeRole(
  calleeRole: string,
  approvedSpecs: readonly AgentSpecContent[],
): RoleResolution {
  const matching = approvedSpecs.filter((spec) => spec.declaredRoles.includes(calleeRole));
  if (matching.length === 0) {
    return { outcome: "unresolved" };
  }

  const distinctSpecIds = [...new Set(matching.map((spec) => spec.specId))];
  if (distinctSpecIds.length > 1) {
    return { outcome: "ambiguous", matchingSpecIds: distinctSpecIds };
  }

  const onlySpecId = distinctSpecIds[0] as SpecId; // length === 1, guaranteed by the branch above
  const versions = matching.filter((spec) => spec.specId === onlySpecId);
  return { outcome: "resolved", spec: pickHighestVersion(versions) };
}

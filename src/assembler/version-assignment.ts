import type { AgentSpecContent } from "../schema/agent-spec-content.js";
import type { SpecId } from "../schema/common.js";

export interface VersionAssignment {
  readonly version: string;
  readonly parentVersion: string | null;
}

/**
 * Deliberately simple for v0.1: monotonic integer version strings, assigned
 * solely by the assembler. Safe only because the assembler is the sole writer
 * of `version` — `approvedSpecs` never crosses a trust boundary the way
 * `draftCandidate` does.
 */
function parseVersionInt(version: string): number {
  const parsed = Number.parseInt(version, 10);
  if (!Number.isInteger(parsed) || String(parsed) !== version) {
    throw new Error(`assembler v0.1 expects monotonic integer version strings; got "${version}"`);
  }
  return parsed;
}

export function assignVersion(
  specId: SpecId,
  approvedSpecs: readonly AgentSpecContent[],
): VersionAssignment {
  const sameSpecIdVersions = approvedSpecs
    .filter((spec) => spec.specId === specId)
    .map((spec) => parseVersionInt(spec.version));

  if (sameSpecIdVersions.length === 0) {
    return { version: "1", parentVersion: null };
  }
  const maxVersion = Math.max(...sameSpecIdVersions);
  return { version: String(maxVersion + 1), parentVersion: String(maxVersion) };
}

/**
 * Multiple versions of the *same* specId are not ambiguous — this picks the
 * highest one deterministically (used by role resolution).
 */
export function pickHighestVersion(specs: readonly AgentSpecContent[]): AgentSpecContent {
  return specs.reduce((highest, current) =>
    parseVersionInt(current.version) > parseVersionInt(highest.version) ? current : highest,
  );
}

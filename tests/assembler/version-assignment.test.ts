import { describe, expect, it } from "vitest";
import { assignVersion } from "../../src/assembler/version-assignment.js";
import { AgentSpecContentSchema } from "../../src/schema/agent-spec-content.js";
import { SpecIdSchema } from "../../src/schema/common.js";
import { validAgentSpecContentRaw, webSearchAgentV1, webSearchAgentV2 } from "../fixtures/specs.js";

function specWithVersion(version: string, parentVersion: string | null) {
  return AgentSpecContentSchema.parse({
    ...validAgentSpecContentRaw,
    specId: "spec-web-search",
    version,
    parentVersion,
    contentHash: `hash-${version}`,
    declaredRoles: ["web-search-agent"],
    declaredAgentCalls: [],
  });
}

describe("assignVersion", () => {
  it("assigns version 1 with no parent when the specId has no prior approved versions", () => {
    const result = assignVersion(SpecIdSchema.parse("spec-brand-new"), [webSearchAgentV1, webSearchAgentV2]);
    expect(result).toEqual({ version: "1", parentVersion: null });
  });

  it("assigns max + 1 when a single prior version exists", () => {
    const result = assignVersion(SpecIdSchema.parse("spec-web-search"), [webSearchAgentV1]);
    expect(result).toEqual({ version: "2", parentVersion: "1" });
  });

  it("uses the maximum version, not the count of versions, for non-contiguous version histories", () => {
    const specs = [specWithVersion("1", null), specWithVersion("2", "1"), specWithVersion("5", "2")];
    const result = assignVersion(SpecIdSchema.parse("spec-web-search"), specs);
    expect(result).toEqual({ version: "6", parentVersion: "5" });
  });

  it("throws when an existing approved spec carries a non-integer version string", () => {
    const specs = [specWithVersion("1.0.0-legacy", null)];
    expect(() => assignVersion(SpecIdSchema.parse("spec-web-search"), specs)).toThrow();
  });
});

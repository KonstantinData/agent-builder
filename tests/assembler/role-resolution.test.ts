import { describe, expect, it } from "vitest";
import { resolveCalleeRole } from "../../src/assembler/role-resolution.js";
import { rivalWebSearchAgent, webSearchAgentV1, webSearchAgentV2 } from "../fixtures/specs.js";

describe("resolveCalleeRole", () => {
  it("returns unresolved when nothing declares the role", () => {
    const result = resolveCalleeRole("nonexistent-role", [webSearchAgentV1]);
    expect(result.outcome).toBe("unresolved");
  });

  it("resolves to the highest version when only one specId matches, across multiple versions", () => {
    const result = resolveCalleeRole("web-search-agent", [webSearchAgentV1, webSearchAgentV2]);
    expect(result.outcome).toBe("resolved");
    if (result.outcome === "resolved") {
      expect(result.spec.specId).toBe("spec-web-search");
      expect(result.spec.version).toBe("2");
    }
  });

  it("is ambiguous when two distinct specIds declare the same role", () => {
    const result = resolveCalleeRole("web-search-agent", [webSearchAgentV1, rivalWebSearchAgent]);
    expect(result.outcome).toBe("ambiguous");
    if (result.outcome === "ambiguous") {
      expect(new Set(result.matchingSpecIds)).toEqual(
        new Set(["spec-web-search", "spec-web-search-rival"]),
      );
    }
  });
});

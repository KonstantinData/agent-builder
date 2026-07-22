import { describe, expect, it } from "vitest";
import { classifyDelta } from "../../src/invariants/classify-delta.js";
import {
  expandingChildSpecContent,
  higherCostChildSpecContent,
  reducedChildSpecContent,
  rolesExpandedChildSpecContent,
  rolesRemovedChildSpecContent,
  validAgentSpecContent,
  widenedIntentChildSpecContent,
  widenedParamsChildSpecContent,
} from "../fixtures/specs.js";

describe("classifyDelta (Invariant 3)", () => {
  it("classifies a strictly narrower budget as capability-reducing", () => {
    expect(classifyDelta(validAgentSpecContent, reducedChildSpecContent)).toBe("capability-reducing");
  });

  it("classifies an identical spec version as neutral", () => {
    expect(classifyDelta(validAgentSpecContent, validAgentSpecContent)).toBe("neutral");
  });

  it("classifies a new call-graph edge as capability-expanding, even with a shrunken budget elsewhere", () => {
    expect(classifyDelta(validAgentSpecContent, expandingChildSpecContent)).toBe("capability-expanding");
  });

  it("classifies a higher cost ceiling as capability-expanding", () => {
    expect(classifyDelta(validAgentSpecContent, higherCostChildSpecContent)).toBe("capability-expanding");
  });

  it("classifies a widened intent set on an existing edge as capability-expanding, even with an unchanged maxDepth/maxCallsPerRun", () => {
    expect(classifyDelta(validAgentSpecContent, widenedIntentChildSpecContent)).toBe("capability-expanding");
  });

  it("classifies a changed tool params object (same toolId/scope) as capability-expanding", () => {
    expect(classifyDelta(validAgentSpecContent, widenedParamsChildSpecContent)).toBe("capability-expanding");
  });

  it("classifies an added declaredRole as capability-expanding", () => {
    expect(classifyDelta(validAgentSpecContent, rolesExpandedChildSpecContent)).toBe("capability-expanding");
  });

  it("classifies a pure declaredRole removal as capability-expanding (conservative, no call-graph visibility)", () => {
    expect(classifyDelta(validAgentSpecContent, rolesRemovedChildSpecContent)).toBe("capability-expanding");
  });
});

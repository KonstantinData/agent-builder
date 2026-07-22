import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "../../src/harness/evaluate-policy.js";
import type { PolicyContext } from "../../src/harness/harness-types.js";
import {
  belowThresholdEvalOutcome,
  doubleViolationChildSpecContent,
  domainSales,
  expandingChildSpecContent,
  forbiddenCombinations,
  passingEvalOutcome,
  reducedChildSpecContent,
  validAgentSpecContent,
  wrongSuiteEvalOutcome,
} from "../fixtures/specs.js";

const baseContext: PolicyContext = {
  approvedSpecs: [validAgentSpecContent],
  trustDomains: [domainSales],
  forbiddenToolCombinations: [],
};

describe("evaluatePolicy", () => {
  it("requires evaluation for a brand-new spec with no evalOutcome supplied", () => {
    const result = evaluatePolicy(validAgentSpecContent, { ...baseContext, approvedSpecs: [] });
    expect(result).toEqual({ outcome: "evaluation_required" });
  });

  it("approves a brand-new spec once a passing evalOutcome is supplied, with delta 'initial'", () => {
    const result = evaluatePolicy(
      validAgentSpecContent,
      { ...baseContext, approvedSpecs: [] },
      passingEvalOutcome,
    );
    expect(result).toEqual({ outcome: "approved_pending_gate", delta: "initial" });
  });

  it("takes the lightweight path for a capability-reducing delta, no evalOutcome needed", () => {
    const result = evaluatePolicy(reducedChildSpecContent, baseContext);
    expect(result).toEqual({ outcome: "approved_pending_gate", delta: "capability-reducing" });
  });

  it("accepts a passing evalOutcome supplied for a capability-reducing delta, even though it wasn't required", () => {
    const result = evaluatePolicy(reducedChildSpecContent, baseContext, passingEvalOutcome);
    expect(result).toEqual({ outcome: "approved_pending_gate", delta: "capability-reducing" });
  });

  it("rejects a capability-reducing delta when a supplied evalOutcome fails, even though evaluation wasn't required", () => {
    const result = evaluatePolicy(reducedChildSpecContent, baseContext, belowThresholdEvalOutcome);
    expect(result).toEqual({
      outcome: "rejected",
      reasons: [{ type: "evaluation_below_threshold", score: 0.5, passThreshold: 0.9 }],
    });
  });

  it("requires evaluation for a capability-expanding delta with no evalOutcome supplied", () => {
    const result = evaluatePolicy(expandingChildSpecContent, baseContext);
    expect(result).toEqual({ outcome: "evaluation_required" });
  });

  it("rejects a capability-expanding delta when the evalOutcome targets the wrong suite", () => {
    const result = evaluatePolicy(expandingChildSpecContent, baseContext, wrongSuiteEvalOutcome);
    expect(result).toEqual({
      outcome: "rejected",
      reasons: [{ type: "evaluation_suite_mismatch", expected: "suite-crm-v1", actual: "suite-other" }],
    });
  });

  it("rejects a capability-expanding delta when the evalOutcome is below the pass threshold", () => {
    const result = evaluatePolicy(expandingChildSpecContent, baseContext, belowThresholdEvalOutcome);
    expect(result).toEqual({
      outcome: "rejected",
      reasons: [{ type: "evaluation_below_threshold", score: 0.5, passThreshold: 0.9 }],
    });
  });

  it("approves a capability-expanding delta once a passing evalOutcome is supplied", () => {
    const result = evaluatePolicy(expandingChildSpecContent, baseContext, passingEvalOutcome);
    expect(result).toEqual({ outcome: "approved_pending_gate", delta: "capability-expanding" });
  });

  it("rejects with parent_version_not_found when no approved spec matches parentVersion, without computing a delta", () => {
    const result = evaluatePolicy(reducedChildSpecContent, { ...baseContext, approvedSpecs: [] });
    expect(result).toEqual({
      outcome: "rejected",
      reasons: [
        { type: "parent_version_not_found", specId: "spec-crm-enricher", parentVersion: "1.0.0" },
      ],
    });
  });

  it("collects trust-domain and forbidden-combination reasons together in a single rejected result", () => {
    const result = evaluatePolicy(doubleViolationChildSpecContent, {
      ...baseContext,
      forbiddenToolCombinations: forbiddenCombinations,
    });
    expect(result.outcome).toBe("rejected");
    if (result.outcome === "rejected") {
      expect(result.reasons.some((reason) => reason.type === "tool_not_allowed_in_domain")).toBe(true);
      expect(result.reasons.some((reason) => reason.type === "forbidden_tool_combination")).toBe(true);
    }
  });
});

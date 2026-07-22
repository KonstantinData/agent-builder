import { describe, expect, it } from "vitest";
import { checkEvaluationOutcome } from "../../src/harness/evaluation-check.js";
import {
  belowThresholdEvalOutcome,
  passingEvalOutcome,
  validAgentSpecContent,
  wrongSuiteEvalOutcome,
} from "../fixtures/specs.js";

describe("checkEvaluationOutcome", () => {
  it("returns no reasons when the outcome matches the suite and clears the threshold", () => {
    expect(checkEvaluationOutcome(validAgentSpecContent, passingEvalOutcome)).toEqual([]);
  });

  it("short-circuits on a suite mismatch, without also reporting the threshold", () => {
    const reasons = checkEvaluationOutcome(validAgentSpecContent, wrongSuiteEvalOutcome);
    expect(reasons).toEqual([
      { type: "evaluation_suite_mismatch", expected: "suite-crm-v1", actual: "suite-other" },
    ]);
  });

  it("flags a score below the required threshold", () => {
    const reasons = checkEvaluationOutcome(validAgentSpecContent, belowThresholdEvalOutcome);
    expect(reasons).toEqual([{ type: "evaluation_below_threshold", score: 0.5, passThreshold: 0.9 }]);
  });

  it("accepts a score exactly equal to the threshold", () => {
    const outcome = { suiteRef: "suite-crm-v1", score: 0.9 };
    expect(checkEvaluationOutcome(validAgentSpecContent, outcome)).toEqual([]);
  });
});

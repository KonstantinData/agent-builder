import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "../../src/harness/evaluate-policy.js";
import type { PolicyContext, PolicySubject } from "../../src/harness/harness-types.js";
import type { AgentSpecContent } from "../../src/schema/agent-spec-content.js";
import {
  belowThresholdEvalOutcome,
  doubleViolationChildSpecContent,
  domainSales,
  evaluationFor,
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
  evaluationReferenceTime: "2026-07-23T12:00:00Z",
};

const subjectOf = (spec: AgentSpecContent): PolicySubject => ({
  specId: spec.specId,
  version: spec.version,
  contentHash: spec.contentHash,
});

describe("evaluatePolicy", () => {
  it("requires evaluation for a brand-new spec with no evalOutcome supplied", () => {
    const result = evaluatePolicy(validAgentSpecContent, { ...baseContext, approvedSpecs: [] });
    expect(result).toEqual({ outcome: "evaluation_required", subject: subjectOf(validAgentSpecContent) });
  });

  it("approves a brand-new spec once a passing evalOutcome is supplied, retaining the held evaluation and delta 'initial'", () => {
    const result = evaluatePolicy(
      validAgentSpecContent,
      { ...baseContext, approvedSpecs: [] },
      passingEvalOutcome,
    );
    expect(result).toEqual({
      outcome: "approved_pending_gate",
      subject: subjectOf(validAgentSpecContent),
      delta: "initial",
      evaluation: passingEvalOutcome,
    });
  });

  it("takes the lightweight path for a capability-reducing delta, no evalOutcome needed", () => {
    const result = evaluatePolicy(reducedChildSpecContent, baseContext);
    expect(result).toEqual({
      outcome: "approved_pending_gate",
      subject: subjectOf(reducedChildSpecContent),
      delta: "capability-reducing",
    });
  });

  it("accepts a passing evalOutcome supplied for a capability-reducing delta, even though it wasn't required", () => {
    const evaluation = evaluationFor(reducedChildSpecContent);
    const result = evaluatePolicy(reducedChildSpecContent, baseContext, evaluation);
    expect(result).toEqual({
      outcome: "approved_pending_gate",
      subject: subjectOf(reducedChildSpecContent),
      delta: "capability-reducing",
      evaluation,
    });
  });

  it("rejects a capability-reducing delta when a supplied evalOutcome fails, retaining the held evaluation", () => {
    const evaluation = evaluationFor(reducedChildSpecContent, { score: 0.5 });
    const result = evaluatePolicy(reducedChildSpecContent, baseContext, evaluation);
    expect(result).toEqual({
      outcome: "rejected",
      subject: subjectOf(reducedChildSpecContent),
      reasons: [{ type: "evaluation_below_threshold", score: 0.5, passThreshold: 0.9 }],
      evaluation,
    });
  });

  it("requires evaluation for a capability-expanding delta with no evalOutcome supplied", () => {
    const result = evaluatePolicy(expandingChildSpecContent, baseContext);
    expect(result).toEqual({ outcome: "evaluation_required", subject: subjectOf(expandingChildSpecContent) });
  });

  it("rejects a capability-expanding delta when the evalOutcome targets the wrong suite", () => {
    const evaluation = evaluationFor(expandingChildSpecContent, { suiteRef: "suite-other" });
    const result = evaluatePolicy(expandingChildSpecContent, baseContext, evaluation);
    expect(result).toEqual({
      outcome: "rejected",
      subject: subjectOf(expandingChildSpecContent),
      reasons: [{ type: "evaluation_suite_mismatch", expected: "suite-crm-v1", actual: "suite-other" }],
      evaluation,
    });
  });

  it("rejects a capability-expanding delta when the evalOutcome is below the pass threshold", () => {
    const evaluation = evaluationFor(expandingChildSpecContent, { score: 0.5 });
    const result = evaluatePolicy(expandingChildSpecContent, baseContext, evaluation);
    expect(result).toEqual({
      outcome: "rejected",
      subject: subjectOf(expandingChildSpecContent),
      reasons: [{ type: "evaluation_below_threshold", score: 0.5, passThreshold: 0.9 }],
      evaluation,
    });
  });

  it("rejects fail-closed when the evalOutcome is not schema-valid (NaN score), never trusting it as evidence", () => {
    const result = evaluatePolicy(
      validAgentSpecContent,
      { ...baseContext, approvedSpecs: [] },
      { ...evaluationFor(validAgentSpecContent), score: NaN },
    );
    expect(result.outcome).toBe("rejected");
    if (result.outcome !== "rejected") return;
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]?.type).toBe("evaluation_outcome_invalid");
    // A distrusted outcome must not be retained as held evidence.
    expect(result.evaluation).toBeUndefined();
  });

  it("rejects fail-closed when the evalOutcome score is out of the [0,1] range", () => {
    const result = evaluatePolicy(
      validAgentSpecContent,
      { ...baseContext, approvedSpecs: [] },
      { ...evaluationFor(validAgentSpecContent), score: 1.5 },
    );
    expect(result.outcome).toBe("rejected");
    if (result.outcome === "rejected") {
      expect(result.reasons[0]?.type).toBe("evaluation_outcome_invalid");
    }
  });

  it("rejects a valid-looking evaluation replayed from another content hash", () => {
    const replayed = evaluationFor(validAgentSpecContent, {
      subject: { ...passingEvalOutcome.subject, contentHash: "other-content" },
    });
    const result = evaluatePolicy(validAgentSpecContent, { ...baseContext, approvedSpecs: [] }, replayed);
    expect(result).toEqual({
      outcome: "rejected",
      subject: subjectOf(validAgentSpecContent),
      reasons: [{
        type: "evaluation_subject_mismatch",
        expected: subjectOf(validAgentSpecContent),
        actual: { ...subjectOf(validAgentSpecContent), contentHash: "other-content" },
      }],
    });
  });

  it("rejects future-dated evaluation evidence and an unknown reference clock", () => {
    const future = evaluationFor(validAgentSpecContent, { completedAt: "2026-07-23T12:00:01Z" });
    expect(evaluatePolicy(validAgentSpecContent, { ...baseContext, approvedSpecs: [] }, future)).toEqual({
      outcome: "rejected",
      subject: subjectOf(validAgentSpecContent),
      reasons: [{
        type: "evaluation_completed_in_future",
        completedAt: "2026-07-23T12:00:01Z",
        referenceTime: baseContext.evaluationReferenceTime,
      }],
    });
    expect(evaluatePolicy(validAgentSpecContent, { ...baseContext, evaluationReferenceTime: "unknown" }, passingEvalOutcome))
      .toMatchObject({ outcome: "rejected", reasons: [{ type: "evaluation_reference_time_invalid" }] });
  });

  it("approves a capability-expanding delta once a passing evalOutcome is supplied, retaining the held evaluation", () => {
    const evaluation = evaluationFor(expandingChildSpecContent);
    const result = evaluatePolicy(expandingChildSpecContent, baseContext, evaluation);
    expect(result).toEqual({
      outcome: "approved_pending_gate",
      subject: subjectOf(expandingChildSpecContent),
      delta: "capability-expanding",
      evaluation,
    });
  });

  it("rejects with parent_version_not_found when no approved spec matches parentVersion, without computing a delta", () => {
    const result = evaluatePolicy(reducedChildSpecContent, { ...baseContext, approvedSpecs: [] });
    expect(result).toEqual({
      outcome: "rejected",
      subject: subjectOf(reducedChildSpecContent),
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
      expect(result.subject).toEqual(subjectOf(doubleViolationChildSpecContent));
      expect(result.reasons.some((reason) => reason.type === "tool_not_allowed_in_domain")).toBe(true);
      expect(result.reasons.some((reason) => reason.type === "forbidden_tool_combination")).toBe(true);
    }
  });
});

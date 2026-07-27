import { describe, expect, it } from "vitest";
import { buildAgentPackage } from "../../src/package/agent-package.js";
import { evaluateDeliveryReadiness } from "../../src/readiness/package-readiness.js";
import { evaluationFor, validAgentSpecContent } from "../fixtures/specs.js";

const topics = ["workflow_and_outcome", "required_information", "allowed_systems", "decision_boundaries", "output_and_tone", "tests_and_acceptance"] as const;
const briefing = { briefingId: "briefing-1", roughRequest: "Build an intake agent.", questions: topics.map((topic, index) => ({ questionId: `q-${index}`, topic, prompt: `Question ${index}`, rationale: "Needed." })), answers: topics.map((topic, index) => ({ questionId: `q-${index}`, topic, sanitizedSummary: "Generic requirement.", sourceClassification: "generic_requirement" as const })), planSummary: "Complete plan.", status: "completed" as const };
const evaluation = evaluationFor(validAgentSpecContent);
const approval = { type: "agent_spec" as const, artifactId: "approval-1", requestedBy: "agent-builder" as const, decision: "approved" as const, decidedBy: "konstantin", decidedAt: "2026-07-27T08:00:00+02:00", specId: validAgentSpecContent.specId, version: validAgentSpecContent.version, contentHash: validAgentSpecContent.contentHash, evidence: { policyOutcome: "approved_pending_gate" as const, delta: "initial" as const, evaluationRef: evaluation } };
const packageValue = buildAgentPackage({ spec: validAgentSpecContent, approval, evaluation });
const security = { commitSha: "a".repeat(40), ciRunUrl: "https://github.com/example/run/1", baselinePassed: true, dependencyAuditPassed: true };

describe("Builder delivery readiness", () => {
  it("marks only a fully evidenced Builder package ready for delivery", () => expect(evaluateDeliveryReadiness({ briefing, package: packageValue, security })).toMatchObject({ ready: true }));
  it("fails closed for incomplete briefing, package, or security evidence", () => {
    expect(evaluateDeliveryReadiness({ briefing: { ...briefing, status: "in_progress" }, package: packageValue, security })).toMatchObject({ ready: false, reasons: expect.arrayContaining(["briefing_incomplete"]) });
    expect(evaluateDeliveryReadiness({ briefing, package: packageValue, security: { ...security, dependencyAuditPassed: false } })).toMatchObject({ ready: false, reasons: expect.arrayContaining(["security_evidence_failed"]) });
  });
});

import { describe, expect, it } from "vitest";
import { buildAgentPackage } from "../../src/package/agent-package.js";
import { evaluateDeliveryReadiness } from "../../src/readiness/package-readiness.js";
import { evaluationFor, validAgentSpecContent } from "../fixtures/specs.js";
import { AgentTemplateSchema } from "../../src/schema/agent-template.js";
import { computeTemplateContentHash } from "../../src/template/template-governance.js";

const topics = ["workflow_and_outcome", "required_information", "allowed_systems", "decision_boundaries", "output_and_tone", "tests_and_acceptance"] as const;
const briefing = { briefingId: "briefing-1", roughRequest: "Build an intake agent.", questions: topics.map((topic, index) => ({ questionId: `q-${index}`, topic, prompt: `Question ${index}`, rationale: "Needed." })), answers: topics.map((topic, index) => ({ questionId: `q-${index}`, topic, sanitizedSummary: "Generic requirement.", sourceClassification: "generic_requirement" as const })), planSummary: "Complete plan.", status: "completed" as const };
const evaluation = evaluationFor(validAgentSpecContent);
const approval = { type: "agent_spec" as const, artifactId: "approval-1", requestedBy: "agent-builder" as const, decision: "approved" as const, decidedBy: "konstantin", decidedAt: "2026-07-27T08:00:00+02:00", specId: validAgentSpecContent.specId, version: validAgentSpecContent.version, contentHash: validAgentSpecContent.contentHash, evidence: { policyOutcome: "approved_pending_gate" as const, delta: "initial" as const, evaluationRef: evaluation } };
const packageValue = buildAgentPackage({ spec: validAgentSpecContent, approval, evaluation });
const security = { commitSha: "a".repeat(40), ciRunUrl: "https://github.com/example/run/1", baselinePassed: true, dependencyAuditPassed: true };
const templateBase = { templateId: "template-readiness", templateVersion: "1.0.0", intent: { name: validAgentSpecContent.name, objective: validAgentSpecContent.objective, promptTemplate: validAgentSpecContent.promptTemplate, declaredTools: validAgentSpecContent.declaredTools, declaredRoles: validAgentSpecContent.declaredRoles, resourceLimits: validAgentSpecContent.resourceLimits, evalRequirements: validAgentSpecContent.evalRequirements, memoryScope: validAgentSpecContent.memoryScope, trustDomainId: validAgentSpecContent.trustDomainId, requestedAgentCalls: [] } };
const templateParsed = AgentTemplateSchema.parse({ ...templateBase, contentHash: "0".repeat(64) });
const { contentHash: _hash, ...templateHashable } = templateParsed;
const template = { ...templateHashable, contentHash: computeTemplateContentHash(templateHashable) };
const adaptation = { adaptationId: "adaptation-1", template: { templateId: template.templateId, templateVersion: template.templateVersion }, templateContentHash: template.contentHash, adaptedDraft: { ...template.intent, draftId: "draft-1", specId: validAgentSpecContent.specId }, sanitizedAdaptationSummary: "Generic adaptation." };
const input = { briefing, briefingBinding: { briefingId: briefing.briefingId, adaptationId: adaptation.adaptationId, draftId: adaptation.adaptedDraft.draftId }, template, adaptation, spec: validAgentSpecContent, approval, evaluation, package: packageValue, security };

describe("Builder delivery readiness", () => {
  it("marks only a fully evidenced Builder package ready for delivery", () => expect(evaluateDeliveryReadiness(input)).toMatchObject({ ready: true }));
  it("fails closed for incomplete briefing, package, or security evidence", () => {
    expect(evaluateDeliveryReadiness({ ...input, briefing: { ...briefing, status: "in_progress" } })).toMatchObject({ ready: false, reasons: expect.arrayContaining(["briefing_incomplete"]) });
    expect(evaluateDeliveryReadiness({ ...input, security: { ...security, dependencyAuditPassed: false } })).toMatchObject({ ready: false, reasons: expect.arrayContaining(["security_evidence_failed"]) });
    expect(evaluateDeliveryReadiness({ ...input, adaptation: { ...adaptation, templateContentHash: "0".repeat(64) } })).toMatchObject({ ready: false, reasons: expect.arrayContaining(["template_adaptation_invalid"]) });
  });
});

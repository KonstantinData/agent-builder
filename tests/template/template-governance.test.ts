import { describe, expect, it } from "vitest";
import {
  computeTemplateContentHash,
  promoteApprovedTemplateFeedback,
  validateTemplateAdaptation,
} from "../../src/template/template-governance.js";
import { AgentTemplateSchema } from "../../src/schema/agent-template.js";

function template(version = "1.0.0") {
  const base = {
    templateId: "template-lead-intake",
    templateVersion: version,
    intent: {
      name: "Lead Intake",
      objective: "Collect and qualify a lead without external effects.",
      promptTemplate: "You are a lead-intake agent.",
      declaredTools: [],
      declaredRoles: ["lead-intake"],
      resourceLimits: { costCeiling: 1, maxIterations: 3, timeoutMs: 5_000 },
      evalRequirements: { suiteRef: "suite-lead-intake-v1", passThreshold: 0.9 },
      memoryScope: "lead-intake-template",
      trustDomainId: "domain-sales",
      requestedAgentCalls: [],
    },
  };
  const parsed = AgentTemplateSchema.parse({ ...base, contentHash: "0".repeat(64) });
  const { contentHash: _placeholderHash, ...hashable } = parsed;
  return { ...hashable, contentHash: computeTemplateContentHash(hashable) };
}

describe("template governance", () => {
  it("binds a one-off adaptation to one exact immutable template version", () => {
    const source = template();
    const adaptation = {
      adaptationId: "adaptation-001",
      template: { templateId: source.templateId, templateVersion: source.templateVersion },
      templateContentHash: source.contentHash,
      adaptedDraft: {
        ...source.intent,
        draftId: "draft-001",
        specId: "spec-lead-intake-001",
      },
      sanitizedAdaptationSummary: "Adapt the generic intake flow without retaining customer data.",
    };
    expect(validateTemplateAdaptation(source, adaptation)).toMatchObject({ success: true });
  });

  it("rejects an adaptation that changes the selected template identity or content", () => {
    const source = template();
    const adaptation = {
      adaptationId: "adaptation-001",
      template: { templateId: source.templateId, templateVersion: "2.0.0" },
      templateContentHash: source.contentHash,
      adaptedDraft: { ...source.intent, draftId: "draft-001", specId: "spec-lead-intake-001" },
      sanitizedAdaptationSummary: "A summary.",
    };
    expect(validateTemplateAdaptation(source, adaptation)).toMatchObject({
      success: false,
      reason: "template_reference_mismatch",
    });
    expect(validateTemplateAdaptation({ ...source, contentHash: "0".repeat(64) }, adaptation)).toMatchObject({
      success: false,
      reason: "template_content_hash_mismatch",
    });
  });

  it("promotes a feedback proposal only with an explicit approval and a new template version", () => {
    const source = template();
    const proposed = template("1.1.0");
    const proposal = {
      proposalId: "feedback-001",
      sourceTemplate: { templateId: source.templateId, templateVersion: source.templateVersion },
      proposedTemplate: proposed,
      sanitizedFeedbackSummary: "Improve the generic exception wording.",
      rationale: "A reviewed operating observation suggests a clearer generic fallback.",
    };
    const approval = {
      approvalId: "approval-feedback-001",
      proposalId: proposal.proposalId,
      decision: "approved",
      decidedBy: "konstantin",
      decidedAt: "2026-07-27T01:00:00+02:00",
    };
    expect(promoteApprovedTemplateFeedback(source, proposal, approval)).toMatchObject({
      success: true,
      value: { templateVersion: "1.1.0" },
    });
    expect(promoteApprovedTemplateFeedback(source, proposal, { ...approval, decision: "rejected" })).toMatchObject({
      success: false,
      reason: "feedback_not_explicitly_approved",
    });
  });

  it("rejects feedback that attempts to overwrite the source version", () => {
    const source = template();
    const proposal = {
      proposalId: "feedback-001",
      sourceTemplate: { templateId: source.templateId, templateVersion: source.templateVersion },
      proposedTemplate: source,
      sanitizedFeedbackSummary: "A summary.",
      rationale: "A rationale.",
    };
    const approval = {
      approvalId: "approval-feedback-001",
      proposalId: proposal.proposalId,
      decision: "approved",
      decidedBy: "konstantin",
      decidedAt: "2026-07-27T01:00:00+02:00",
    };
    expect(promoteApprovedTemplateFeedback(source, proposal, approval)).toMatchObject({
      success: false,
      reason: "schema_validation_failed",
    });
  });
});

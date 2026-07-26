import { createHash } from "node:crypto";
import { canonicalize } from "../assembler/content-hash.js";
import {
  AgentTemplateSchema,
  TemplateAdaptationSchema,
  TemplateFeedbackApprovalSchema,
  TemplateFeedbackProposalSchema,
  type AgentTemplate,
  type TemplateAdaptation,
} from "../schema/agent-template.js";

export type TemplateGovernanceResult<T> =
  | { readonly success: true; readonly value: T }
  | { readonly success: false; readonly reason: string };

export function computeTemplateContentHash(template: Omit<AgentTemplate, "contentHash">): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(template))).digest("hex");
}

/**
 * Selects an immutable template for a one-off draft. The returned adaptation
 * has no customer runtime identity and cannot update a delivered package.
 */
export function validateTemplateAdaptation(
  templateCandidate: unknown,
  adaptationCandidate: unknown,
): TemplateGovernanceResult<TemplateAdaptation> {
  const template = AgentTemplateSchema.safeParse(templateCandidate);
  const adaptation = TemplateAdaptationSchema.safeParse(adaptationCandidate);
  if (!template.success || !adaptation.success) {
    return { success: false, reason: "schema_validation_failed" };
  }
  const { contentHash, ...hashableTemplate } = template.data;
  if (contentHash !== computeTemplateContentHash(hashableTemplate)) {
    return { success: false, reason: "template_content_hash_mismatch" };
  }
  if (
    adaptation.data.template.templateId !== template.data.templateId ||
    adaptation.data.template.templateVersion !== template.data.templateVersion ||
    adaptation.data.templateContentHash !== contentHash
  ) {
    return { success: false, reason: "template_reference_mismatch" };
  }
  return { success: true, value: adaptation.data };
}

/**
 * Promotes a feedback proposal only after an explicit approved decision. It
 * returns a new immutable template value and never changes a prior version or
 * a delivered customer package.
 */
export function promoteApprovedTemplateFeedback(
  sourceCandidate: unknown,
  proposalCandidate: unknown,
  approvalCandidate: unknown,
): TemplateGovernanceResult<AgentTemplate> {
  const source = AgentTemplateSchema.safeParse(sourceCandidate);
  const proposal = TemplateFeedbackProposalSchema.safeParse(proposalCandidate);
  const approval = TemplateFeedbackApprovalSchema.safeParse(approvalCandidate);
  if (!source.success || !proposal.success || !approval.success) {
    return { success: false, reason: "schema_validation_failed" };
  }
  if (
    proposal.data.sourceTemplate.templateId !== source.data.templateId ||
    proposal.data.sourceTemplate.templateVersion !== source.data.templateVersion
  ) {
    return { success: false, reason: "source_template_mismatch" };
  }
  if (approval.data.proposalId !== proposal.data.proposalId || approval.data.decision !== "approved") {
    return { success: false, reason: "feedback_not_explicitly_approved" };
  }
  const { contentHash, ...hashableTemplate } = proposal.data.proposedTemplate;
  if (contentHash !== computeTemplateContentHash(hashableTemplate)) {
    return { success: false, reason: "promoted_template_content_hash_mismatch" };
  }
  return { success: true, value: proposal.data.proposedTemplate };
}

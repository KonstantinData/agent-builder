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

export function computeBuilderIntentDraftContentHash(draft: unknown): string {
  const value = draft as { provenance?: Record<string, unknown> };
  const provenance = value.provenance;
  const hashable = provenance === undefined
    ? draft
    : { ...value, provenance: Object.fromEntries(Object.entries(provenance).filter(([key]) => key !== "adaptationContentHash")) };
  return createHash("sha256").update(JSON.stringify(canonicalize(hashable))).digest("hex");
}

export function computeTemplateAdaptationContentHash(
  adaptation: Omit<TemplateAdaptation, "adaptationContentHash">,
): string {
  const material = {
    adaptationId: adaptation.adaptationId,
    template: adaptation.template,
    templateContentHash: adaptation.templateContentHash,
    briefing: adaptation.briefing,
    draftContentHash: adaptation.draftContentHash,
    sanitizedAdaptationSummary: adaptation.sanitizedAdaptationSummary,
  };
  return createHash("sha256").update(JSON.stringify(canonicalize(material))).digest("hex");
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
  if (adaptation.data.draftContentHash !== computeBuilderIntentDraftContentHash(adaptation.data.adaptedDraft)) {
    return { success: false, reason: "draft_content_hash_mismatch" };
  }
  const { adaptationContentHash, ...hashableAdaptation } = adaptation.data;
  if (adaptationContentHash !== computeTemplateAdaptationContentHash(hashableAdaptation)) {
    return { success: false, reason: "adaptation_content_hash_mismatch" };
  }
  if (
    adaptation.data.adaptedDraft.provenance.adaptationId !== adaptation.data.adaptationId ||
    adaptation.data.adaptedDraft.provenance.adaptationContentHash !== adaptation.data.adaptationContentHash ||
    adaptation.data.adaptedDraft.provenance.draftId !== adaptation.data.adaptedDraft.draftId ||
    adaptation.data.adaptedDraft.provenance.briefingId !== adaptation.data.briefing.briefingId ||
    adaptation.data.adaptedDraft.provenance.flowDigest !== adaptation.data.briefing.flowDigest ||
    adaptation.data.adaptedDraft.provenance.planInputDigest !== adaptation.data.briefing.planInputDigest
  ) {
    return { success: false, reason: "briefing_provenance_mismatch" };
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

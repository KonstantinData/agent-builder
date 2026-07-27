import { z } from "zod";
import { BuilderIntentDraftSchema } from "./builder-intent-draft.js";
import { BriefingProvenanceSchema } from "./briefing-provenance.js";
import { Rfc3339WithOffsetSchema } from "./runtime-binding-validity.js";

const TemplateReferenceSchema = z
  .object({
    templateId: z.string().min(1),
    templateVersion: z.string().min(1),
  })
  .strict();
export type TemplateReference = z.infer<typeof TemplateReferenceSchema>;

/**
 * Reusable Builder source material. A template is immutable once versioned;
 * completed customer packages are never a source for this object.
 */
export const AgentTemplateSchema = z
  .object({
    ...TemplateReferenceSchema.shape,
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    intent: BuilderIntentDraftSchema.omit({ draftId: true, specId: true, provenance: true }),
  })
  .strict();
export type AgentTemplate = z.infer<typeof AgentTemplateSchema>;

/** A one-off proposed draft, bound to the exact immutable template version. */
export const TemplateAdaptationSchema = z
  .object({
    adaptationId: z.string().min(1),
    template: TemplateReferenceSchema,
    templateContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    briefing: BriefingProvenanceSchema,
    adaptedDraft: BuilderIntentDraftSchema,
    draftContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    adaptationContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    sanitizedAdaptationSummary: z.string().min(1),
  })
  .strict();
export type TemplateAdaptation = z.infer<typeof TemplateAdaptationSchema>;

export const TemplateFeedbackProposalSchema = z
  .object({
    proposalId: z.string().min(1),
    sourceTemplate: TemplateReferenceSchema,
    proposedTemplate: AgentTemplateSchema,
    sanitizedFeedbackSummary: z.string().min(1),
    rationale: z.string().min(1),
  })
  .strict()
  .superRefine((proposal, context) => {
    if (proposal.proposedTemplate.templateId !== proposal.sourceTemplate.templateId) {
      context.addIssue({
        code: "custom",
        path: ["proposedTemplate", "templateId"],
        message: "a feedback proposal may only create a new version of its source template",
      });
    }
    if (proposal.proposedTemplate.templateVersion === proposal.sourceTemplate.templateVersion) {
      context.addIssue({
        code: "custom",
        path: ["proposedTemplate", "templateVersion"],
        message: "a feedback proposal must create a distinct template version",
      });
    }
  });
export type TemplateFeedbackProposal = z.infer<typeof TemplateFeedbackProposalSchema>;

/**
 * Persistable evidence of an explicit human decision. Identity attestation is
 * outside this schema, as with the existing agent-spec approval artifact.
 */
export const TemplateFeedbackApprovalSchema = z
  .object({
    approvalId: z.string().min(1),
    proposalId: z.string().min(1),
    decision: z.enum(["approved", "rejected"]),
    decidedBy: z.literal("konstantin"),
    decidedAt: Rfc3339WithOffsetSchema,
    reason: z.string().min(1).optional(),
  })
  .strict();
export type TemplateFeedbackApproval = z.infer<typeof TemplateFeedbackApprovalSchema>;

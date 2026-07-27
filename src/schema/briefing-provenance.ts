import { z } from "zod";

/**
 * Immutable pointer to the signed, completed contextual briefing that issued a
 * delivery draft. The two digests bind both the completed flow and the plan's
 * pre-completion input; neither is a user-supplied display identifier.
 */
export const BriefingProvenanceSchema = z
  .object({
    briefingId: z.string().min(1),
    flowDigest: z.string().regex(/^[a-f0-9]{64}$/),
    planInputDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type BriefingProvenance = z.infer<typeof BriefingProvenanceSchema>;

export const DraftProvenanceSchema = BriefingProvenanceSchema.extend({
  adaptationId: z.string().min(1),
  draftId: z.string().min(1),
  adaptationContentHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type DraftProvenance = z.infer<typeof DraftProvenanceSchema>;

export const SpecProvenanceSchema = DraftProvenanceSchema.extend({
  draftContentHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type SpecProvenance = z.infer<typeof SpecProvenanceSchema>;

import { z } from "zod";
import { SpecIdSchema } from "./common.js";
import { Rfc3339WithOffsetSchema } from "./runtime-binding-validity.js";

/**
 * An already-finished evaluation result fed into the policy harness from outside
 * (Step 4 never runs a suite itself). It is evidence for one immutable candidate,
 * not a reusable score. The environment is constrained to disposable mocks with
 * no production data or credentials; host attestation remains outside Builder.
 */
export const EvaluationEvidenceSubjectSchema = z
  .object({
    specId: SpecIdSchema,
    version: z.string().min(1),
    contentHash: z.string().min(1),
  })
  .strict();
export type EvaluationEvidenceSubject = z.infer<typeof EvaluationEvidenceSubjectSchema>;

export const EvaluationOutcomeSchema = z
  .object({
    evidenceId: z.string().min(1),
    subject: EvaluationEvidenceSubjectSchema,
    suiteRef: z.string().min(1),
    score: z.number().min(0).max(1),
    completedAt: Rfc3339WithOffsetSchema,
    environment: z.literal("disposable_mock"),
    usedProductionData: z.literal(false),
    usedProductionCredentials: z.literal(false),
  })
  .strict();
export type EvaluationOutcome = z.infer<typeof EvaluationOutcomeSchema>;

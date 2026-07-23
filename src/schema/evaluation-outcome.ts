import { z } from "zod";

/**
 * An already-finished evaluation result fed into the policy harness from outside
 * (Step 4 never runs a suite itself). Because it is untrusted input, it is a
 * validated schema, not a bare interface: `score` is constrained to `[0, 1]`,
 * which rejects `NaN` (fails `min`) and out-of-range values that would otherwise
 * pass the `score < passThreshold` comparison fail-open. `suiteRef` must be
 * non-empty. Invalid outcomes are rejected structurally (fail-closed) by the
 * caller, never thrown.
 */
export const EvaluationOutcomeSchema = z
  .object({
    suiteRef: z.string().min(1),
    score: z.number().min(0).max(1),
  })
  .strict();
export type EvaluationOutcome = z.infer<typeof EvaluationOutcomeSchema>;

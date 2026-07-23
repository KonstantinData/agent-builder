import { z } from "zod";
import { SpecIdSchema } from "./common.js";

/**
 * Run identifiers are opaque Data Plane identifiers. Step 12 makes them
 * signature-bound, so the structural boundary must reject the empty string
 * before a run identity can become load-bearing.
 */
export const RunIdSchema = z.string().min(1);
export type RunId = z.infer<typeof RunIdSchema>;

/**
 * Enforced by the Data Plane on every agent-to-agent call (Section 10).
 * `callChain` carries the full ancestry, not just a depth counter, so cycle
 * rejection does not depend on any individual edge's `maxDepth`.
 */
export const CallContextSchema = z
  .object({
    rootRunId: RunIdSchema,
    parentRunId: RunIdSchema.nullable(),
    callChain: z.array(SpecIdSchema).min(1),
    remainingDepth: z.number().int().nonnegative(),
    remainingCallBudget: z.number().int().nonnegative(),
    remainingTokenBudget: z.number().int().nonnegative(),
    remainingTimeBudget: z.number().nonnegative(),
  })
  .strict();
export type CallContext = z.infer<typeof CallContextSchema>;

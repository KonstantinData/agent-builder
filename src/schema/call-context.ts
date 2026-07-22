import { z } from "zod";
import { SpecIdSchema } from "./common.js";

/**
 * Enforced by the Data Plane on every agent-to-agent call (Section 10).
 * `callChain` carries the full ancestry, not just a depth counter, so cycle
 * rejection does not depend on any individual edge's `maxDepth`.
 */
export const CallContextSchema = z
  .object({
    rootRunId: z.string().min(1),
    parentRunId: z.string().nullable(),
    callChain: z.array(SpecIdSchema),
    remainingDepth: z.number().int().nonnegative(),
    remainingCallBudget: z.number().int().nonnegative(),
    remainingTokenBudget: z.number().int().nonnegative(),
    remainingTimeBudget: z.number().nonnegative(),
  })
  .strict();
export type CallContext = z.infer<typeof CallContextSchema>;

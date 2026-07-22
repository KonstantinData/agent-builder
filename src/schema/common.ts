import { z } from "zod";

export const SpecIdSchema = z.string().min(1).brand<"SpecId">();
export type SpecId = z.infer<typeof SpecIdSchema>;

export const TrustDomainIdSchema = z.string().min(1).brand<"TrustDomainId">();
export type TrustDomainId = z.infer<typeof TrustDomainIdSchema>;

/**
 * Closed catalog of tool identifiers. New tools are added here, never inferred
 * from a wildcard pattern (Core Invariant: "no wildcard tool or agent-call grants").
 */
export const TOOL_CATALOG = [
  "http.fetch",
  "fs.read",
  "fs.write",
  "db.query",
  "email.send",
  "crm.enrich",
] as const;
export const ToolIdSchema = z.enum(TOOL_CATALOG);
export type ToolId = z.infer<typeof ToolIdSchema>;

/**
 * Closed catalog of agent-to-agent call intents. `allowed_intents` must never
 * accept free text (Section 8 of the architecture doc).
 */
export const AGENT_CALL_INTENT_CATALOG = [
  "delegate",
  "query",
  "notify",
  "summarize",
  "execute_tool",
] as const;
export const AgentCallIntentSchema = z.enum(AGENT_CALL_INTENT_CATALOG);
export type AgentCallIntent = z.infer<typeof AgentCallIntentSchema>;

const WILDCARD_PATTERN = /[*?%]/;

/**
 * Free-text fields that are not covered by a closed catalog (memory scope, tool
 * scope) still must not contain wildcard characters.
 */
export const NoWildcardStringSchema = z
  .string()
  .min(1)
  .refine((value) => !WILDCARD_PATTERN.test(value), {
    message: "wildcard characters (*, ?, %) are not allowed",
  });
export type NoWildcardString = z.infer<typeof NoWildcardStringSchema>;

export const BudgetSchema = z
  .object({
    costCeiling: z.number().nonnegative(),
    maxIterations: z.number().int().positive(),
    timeoutMs: z.number().int().positive(),
  })
  .strict();
export type Budget = z.infer<typeof BudgetSchema>;

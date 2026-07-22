import { z } from "zod";
import {
  AgentCallIntentSchema,
  BudgetSchema,
  NoWildcardStringSchema,
  SpecIdSchema,
  TrustDomainIdSchema,
} from "./common.js";
import { DeclaredToolSchema, EvalRequirementsSchema } from "./agent-spec-content.js";

/**
 * Pre-hash, non-executable request for an agent-to-agent call. Only
 * `calleeRole` is allowed here — never `calleeSpecId`. The Spec Assembler must
 * resolve every role into a concrete `calleeSpecId`/`calleeVersionOrChannel`
 * before a spec is hashed and approved (Section 3 of the architecture doc).
 * `maxDepth`/`maxCallsPerRun` are proposed here by the Builder because nothing
 * else can supply them — they carry straight through into the resolved edge.
 */
export const RequestedAgentCallSchema = z
  .object({
    calleeRole: z.string().min(1),
    allowedIntents: z.array(AgentCallIntentSchema).min(1),
    maxDepth: z.number().int().nonnegative(),
    maxCallsPerRun: z.number().int().positive(),
    rationale: z.string().min(1),
  })
  .strict();
export type RequestedAgentCall = z.infer<typeof RequestedAgentCallSchema>;

/**
 * `BuilderIntentDraft` is intentionally not related to `AgentSpecContent` by
 * extension or inheritance — a role-based request must not be able to leak
 * into immutable, hashed spec content. Value-object shapes with no resolution
 * ambiguity (`DeclaredToolSchema`, `BudgetSchema`, `EvalRequirementsSchema`)
 * are reused as-is, since they carry straight through unchanged.
 */
export const BuilderIntentDraftSchema = z
  .object({
    draftId: z.string().min(1),
    specId: SpecIdSchema,
    name: z.string().min(1),
    objective: z.string().min(1),
    promptTemplate: z.string().min(1),
    declaredTools: z.array(DeclaredToolSchema),
    declaredRoles: z.array(NoWildcardStringSchema).min(1),
    resourceLimits: BudgetSchema,
    evalRequirements: EvalRequirementsSchema,
    memoryScope: NoWildcardStringSchema,
    trustDomainId: TrustDomainIdSchema,
    requestedAgentCalls: z.array(RequestedAgentCallSchema),
  })
  .strict();
export type BuilderIntentDraft = z.infer<typeof BuilderIntentDraftSchema>;

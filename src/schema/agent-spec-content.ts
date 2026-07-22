import { z } from "zod";
import {
  AgentCallIntentSchema,
  BudgetSchema,
  NoWildcardStringSchema,
  SpecIdSchema,
  ToolIdSchema,
  TrustDomainIdSchema,
  type Budget,
  type SpecId,
  type TrustDomainId,
} from "./common.js";

/**
 * Resolved-only agent-to-agent call declaration. There is no `calleeRole`
 * field here — `.strict()` rejects it at runtime if present, closing the
 * "role as indirect wildcard" gap discussed in the architecture review.
 */
export const ResolvedAgentCallSchema = z
  .object({
    calleeSpecId: SpecIdSchema,
    calleeVersionOrChannel: z.string().min(1),
    allowedIntents: z.array(AgentCallIntentSchema).min(1),
    maxDepth: z.number().int().nonnegative(),
    maxCallsPerRun: z.number().int().positive(),
  })
  .strict();
export type ResolvedAgentCall = z.infer<typeof ResolvedAgentCallSchema>;

export const DeclaredToolSchema = z
  .object({
    toolId: ToolIdSchema,
    scope: NoWildcardStringSchema,
    params: z.record(z.string(), z.union([NoWildcardStringSchema, z.number(), z.boolean()])),
  })
  .strict();
export type DeclaredTool = z.infer<typeof DeclaredToolSchema>;

export const EvalRequirementsSchema = z
  .object({
    suiteRef: z.string().min(1),
    passThreshold: z.number().min(0).max(1),
  })
  .strict();
export type EvalRequirements = z.infer<typeof EvalRequirementsSchema>;

/**
 * Immutable, versioned, hashable spec content (Section 3 of the architecture
 * doc). `trustDomainId` is a single scalar field, never a list (Core
 * Invariant 2). `declaredAgentCalls` only ever contains resolved edges.
 */
export const AgentSpecContentSchema = z
  .object({
    specId: SpecIdSchema,
    version: z.string().min(1),
    parentVersion: z.string().nullable(),
    contentHash: z.string().min(1),
    name: z.string().min(1),
    objective: z.string().min(1),
    promptTemplate: z.string().min(1),
    declaredTools: z.array(DeclaredToolSchema),
    declaredAgentCalls: z.array(ResolvedAgentCallSchema),
    resourceLimits: BudgetSchema,
    evalRequirements: EvalRequirementsSchema,
    memoryScope: NoWildcardStringSchema,
    trustDomainId: TrustDomainIdSchema,
    declaredRoles: z.array(NoWildcardStringSchema).min(1),
  })
  .strict();

/**
 * Hand-declared `readonly` interface, bound to the schema below via
 * `satisfies`. This makes immutability visible in the type system, on top of
 * the runtime `.strict()` validation Zod already performs.
 */
export interface AgentSpecContent {
  readonly specId: SpecId;
  readonly version: string;
  readonly parentVersion: string | null;
  readonly contentHash: string;
  readonly name: string;
  readonly objective: string;
  readonly promptTemplate: string;
  readonly declaredTools: ReadonlyArray<DeclaredTool>;
  readonly declaredAgentCalls: ReadonlyArray<ResolvedAgentCall>;
  readonly resourceLimits: Budget;
  readonly evalRequirements: EvalRequirements;
  readonly memoryScope: string;
  readonly trustDomainId: TrustDomainId;
  readonly declaredRoles: ReadonlyArray<string>;
}

// Compile-time guarantee that schema output and the readonly interface never
// drift apart.
export const _agentSpecContentTypeBinding =
  AgentSpecContentSchema satisfies z.ZodType<AgentSpecContent>;

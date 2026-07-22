import { z } from "zod";
import {
  AgentCallIntentSchema,
  NoWildcardStringSchema,
  SpecIdSchema,
  TrustDomainIdSchema,
} from "./common.js";

/**
 * Default-deny directed graph edge (Section 8). Field name normalized to
 * `trustDomainId` for consistency with `TrustDomain`/`AgentSpecContent` — the
 * architecture doc uses the free-standing name `trust_domain` on the edge,
 * this implementation binds it to the same branded `TrustDomainId` type.
 */
export const AgentCallPolicyEdgeSchema = z
  .object({
    callerSpecId: SpecIdSchema,
    callerVersion: z.string().min(1),
    calleeSpecId: SpecIdSchema,
    calleeVersionOrChannel: z.string().min(1),
    allowedIntents: z.array(AgentCallIntentSchema).min(1),
    dataShareScope: NoWildcardStringSchema,
    maxDepth: z.number().int().nonnegative(),
    maxCallsPerRun: z.number().int().positive(),
    maxCallsPerTimeWindow: z.number().int().positive(),
    requiresHumanGate: z.boolean(),
    trustDomainId: TrustDomainIdSchema,
  })
  .strict();
export type AgentCallPolicyEdge = z.infer<typeof AgentCallPolicyEdgeSchema>;

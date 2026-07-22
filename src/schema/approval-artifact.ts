import { z } from "zod";
import { SpecIdSchema, TrustDomainIdSchema, ToolIdSchema } from "./common.js";
import { AgentCallPolicyEdgeSchema } from "./agent-call-policy-edge.js";

/**
 * Section 7: one approval mechanism, multiple artifact types. Every variant
 * shares the same decision/audit shape so review, audit, and human-gate logic
 * stay unified regardless of what is being approved.
 */
const ApprovalDecisionFields = {
  artifactId: z.string().min(1),
  requestedBy: z.string().min(1),
  decision: z.enum(["pending", "approved", "rejected"]),
  decidedBy: z.string().optional(),
  decidedAt: z.string().optional(),
  reason: z.string().optional(),
};

export const AgentSpecApprovalSchema = z
  .object({
    type: z.literal("agent_spec"),
    ...ApprovalDecisionFields,
    specId: SpecIdSchema,
    version: z.string().min(1),
  })
  .strict();

export const CallGraphEdgeApprovalSchema = z
  .object({
    type: z.literal("call_graph_edge"),
    ...ApprovalDecisionFields,
    edge: AgentCallPolicyEdgeSchema,
  })
  .strict();

export const TrustDomainRuleApprovalSchema = z
  .object({
    type: z.literal("trust_domain_rule"),
    ...ApprovalDecisionFields,
    domainId: TrustDomainIdSchema,
  })
  .strict();

export const ToolCapabilityApprovalSchema = z
  .object({
    type: z.literal("tool_capability"),
    ...ApprovalDecisionFields,
    toolId: ToolIdSchema,
  })
  .strict();

export const ApprovalArtifactSchema = z.discriminatedUnion("type", [
  AgentSpecApprovalSchema,
  CallGraphEdgeApprovalSchema,
  TrustDomainRuleApprovalSchema,
  ToolCapabilityApprovalSchema,
]);
export type ApprovalArtifact = z.infer<typeof ApprovalArtifactSchema>;

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

/**
 * Closed catalog of the policy-rejection reason `type` values (Step 4). Kept as
 * the single source of truth so the Approval Evidence can reference reason codes
 * without duplicating the full `PolicyRejectionReason` union — `harness-types`
 * carries a compile-time check that this catalog and that union never drift.
 * Lives in the schema layer (lowest); the harness depends on it, never the
 * reverse.
 */
export const POLICY_REJECTION_REASON_CODES = [
  "trust_domain_not_found",
  "tool_not_allowed_in_domain",
  "role_not_allowed_in_domain",
  "forbidden_tool_combination",
  "parent_version_not_found",
  "evaluation_outcome_invalid",
  "evaluation_suite_mismatch",
  "evaluation_below_threshold",
] as const;
export const PolicyRejectionReasonCodeSchema = z.enum(POLICY_REJECTION_REASON_CODES);
export type PolicyRejectionReasonCode = z.infer<typeof PolicyRejectionReasonCodeSchema>;

/**
 * Closed delta domain carried in approved evidence. Exported so the harness can
 * compile-time-assert it equals `DeltaClassification | "initial"` (same
 * anti-drift guard as the reason codes). Lives here because the schema layer
 * cannot import from `invariants` without a cycle.
 */
export const APPROVAL_EVIDENCE_DELTAS = [
  "initial",
  "capability-expanding",
  "capability-reducing",
  "neutral",
] as const;
export type ApprovalEvidenceDelta = (typeof APPROVAL_EVIDENCE_DELTAS)[number];

const EvaluationRefSchema = z
  .object({ suiteRef: z.string().min(1), score: z.number().min(0).max(1) })
  .strict();

/**
 * Decision *evidence* for an approval — what the gate decided against, not what
 * was approved. A discriminated union on `policyOutcome` so the schema itself
 * rejects incoherent records (an approval carrying rejection codes, a rejection
 * with no codes, etc.) rather than trusting the producer. Deliberately carries
 * no `contentHash`: the exact approved content is bound once at the artifact
 * level (single source of truth). Rejection reasons are stored as closed codes;
 * the full structured reasons stay on the DeploymentGateResult at the TS level.
 */
export const ApprovedEvidenceSchema = z
  .object({
    policyOutcome: z.literal("approved_pending_gate"),
    delta: z.enum(APPROVAL_EVIDENCE_DELTAS),
    evaluationRef: EvaluationRefSchema.optional(),
  })
  .strict()
  .superRefine((evidence, ctx) => {
    // The same fail-closed invariant the gate enforces, made a persistable
    // schema rule: an `initial` or `capability-expanding` approval must carry
    // the evaluation it was gated on. `capability-reducing`/`neutral` need none.
    const needsEvaluation =
      evidence.delta === "initial" || evidence.delta === "capability-expanding";
    if (needsEvaluation && evidence.evaluationRef === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["evaluationRef"],
        message: `approved evidence for delta '${evidence.delta}' requires an evaluationRef`,
      });
    }
  });

export const RejectedEvidenceSchema = z
  .object({
    policyOutcome: z.literal("rejected"),
    rejectionReasonCodes: z.array(PolicyRejectionReasonCodeSchema).min(1),
    evaluationRef: EvaluationRefSchema.optional(),
  })
  .strict();

export const ApprovalEvidenceSchema = z.discriminatedUnion("policyOutcome", [
  ApprovedEvidenceSchema,
  RejectedEvidenceSchema,
]);
export type ApprovalEvidence = z.infer<typeof ApprovalEvidenceSchema>;

/**
 * An agent_spec approval is a *decided* deployment-gate output, so `decision` is
 * narrowed to approved/rejected (no `pending`) and evidence is mandatory. The
 * `decision` <-> `evidence.policyOutcome` agreement is enforced right here via
 * superRefine — Zod 4 keeps a refined object usable inside the outer
 * discriminatedUnion, so there is no standalone blindspot.
 */
export const AgentSpecApprovalSchema = z
  .object({
    type: z.literal("agent_spec"),
    ...ApprovalDecisionFields,
    decision: z.enum(["approved", "rejected"]),
    specId: SpecIdSchema,
    version: z.string().min(1),
    // Subject binding: the exact content approved, bound once here (single
    // source of truth) so an approval cannot be replayed onto different content.
    contentHash: z.string().min(1),
    evidence: ApprovalEvidenceSchema,
  })
  .strict()
  .superRefine((artifact, ctx) => {
    const expected = artifact.decision === "approved" ? "approved_pending_gate" : "rejected";
    if (artifact.evidence.policyOutcome !== expected) {
      ctx.addIssue({
        code: "custom",
        path: ["evidence", "policyOutcome"],
        message: `evidence.policyOutcome '${artifact.evidence.policyOutcome}' does not match decision '${artifact.decision}'`,
      });
    }
  });

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

import type { AgentSpecContent } from "../schema/agent-spec-content.js";
import {
  AgentSpecApprovalSchema,
  type ApprovalArtifact,
  type ApprovalEvidence,
} from "../schema/approval-artifact.js";
import type {
  AgentSpecRuntimeMetadata,
  LifecycleState,
  StateHistoryEntry,
} from "../schema/agent-spec-runtime-metadata.js";
import type { PolicyEvaluationResult } from "../harness/harness-types.js";
import type {
  DeploymentGateRejectionReason,
  DeploymentGateResult,
  TrustedDecisionContext,
} from "./gate-types.js";
import {
  AGENT_CREATION_APPLICANT_ID,
  AGENT_CREATION_APPROVER_ID,
} from "../schema/agent-creation-approval-authority.js";
import { contentHashMatches } from "../assembler/content-hash.js";
import { EvaluationOutcomeSchema } from "../schema/evaluation-outcome.js";

/**
 * Only a spec under review may be gated. Policy and evaluation proofs are audit
 * records inside `in_review` (Section 4), so `draft` is deliberately excluded —
 * gating straight from `draft` would skip exactly that window. Everything else
 * (`approved`/`deployed`/`suspended`/`revoked`/`rejected`) is likewise not
 * re-gateable here.
 */
const GATEABLE_STATE: LifecycleState = "in_review";

function buildApproval(
  candidate: AgentSpecContent,
  metadata: AgentSpecRuntimeMetadata,
  ctx: TrustedDecisionContext,
  decision: "approved" | "rejected",
  evidence: ApprovalEvidence,
): ApprovalArtifact {
  return AgentSpecApprovalSchema.parse({
    type: "agent_spec",
    artifactId: ctx.artifactId,
    requestedBy: metadata.requestor,
    decision,
    decidedBy: ctx.principal.principalId,
    decidedAt: ctx.decidedAt,
    specId: candidate.specId,
    version: candidate.version,
    // Subject binding: the exact approved content, bound once at the artifact.
    contentHash: candidate.contentHash,
    evidence,
    // `reason` is optional and `exactOptionalPropertyTypes` is on, so only
    // attach it when the approver actually supplied one.
    ...(ctx.reason !== undefined ? { reason: ctx.reason } : {}),
  });
}

function withTransition(
  metadata: AgentSpecRuntimeMetadata,
  nextState: LifecycleState,
  ctx: TrustedDecisionContext,
  reason: string,
): AgentSpecRuntimeMetadata {
  const entry: StateHistoryEntry = {
    state: nextState,
    actor: ctx.principal.principalId,
    timestamp: ctx.decidedAt,
    reason,
  };
  return {
    ...metadata,
    state: nextState,
    stateHistory: [...metadata.stateHistory, entry],
  };
}

/**
 * Deployment Gate v0.1. Pure function: consumes an already-decided
 * PolicyEvaluationResult (Step 4) plus a trusted decision context and produces
 * approval + lifecycle artifacts. Never executes a deployment, touches a
 * registry/DB, or transitions to `deployed`; the furthest state it can reach is
 * `approved`.
 */
export function runDeploymentGate(
  candidate: AgentSpecContent,
  metadata: AgentSpecRuntimeMetadata,
  policyResult: PolicyEvaluationResult,
  ctx: TrustedDecisionContext,
): DeploymentGateResult {
  // Guard 1 — only `in_review` is gateable. Non-terminal block, no state change.
  if (metadata.state !== GATEABLE_STATE) {
    return { outcome: "blocked", reason: { type: "state_not_gateable", state: metadata.state } };
  }

  if (!contentHashMatches(candidate)) {
    return {
      outcome: "blocked",
      reason: { type: "content_hash_mismatch", specId: candidate.specId, version: candidate.version },
    };
  }

  const heldEvaluation = "evaluation" in policyResult ? policyResult.evaluation : undefined;
  if (heldEvaluation !== undefined && !EvaluationOutcomeSchema.safeParse(heldEvaluation).success) {
    return { outcome: "blocked", reason: { type: "evaluation_evidence_invalid" } };
  }

  if (
    heldEvaluation !== undefined &&
    (heldEvaluation.subject.specId !== candidate.specId ||
      heldEvaluation.subject.version !== candidate.version ||
      heldEvaluation.subject.contentHash !== candidate.contentHash)
  ) {
    return {
      outcome: "blocked",
      reason: {
        type: "evaluation_evidence_subject_mismatch",
        specId: candidate.specId,
        version: candidate.version,
      },
    };
  }

  // Guard 2 — three-way subject verification: candidate <-> policyResult.subject
  // <-> metadata. A verdict must never be applied to different content than it
  // was produced for.
  const subject = policyResult.subject;
  const subjectMatches =
    subject.specId === candidate.specId &&
    subject.version === candidate.version &&
    subject.contentHash === candidate.contentHash &&
    metadata.specId === candidate.specId &&
    metadata.version === candidate.version;
  if (!subjectMatches) {
    return {
      outcome: "blocked",
      reason: { type: "subject_mismatch", specId: candidate.specId, version: candidate.version },
    };
  }

  // Guard 3 — separation of duties: the requestor cannot approve their own spec.
  if (ctx.principal.principalId === metadata.requestor) {
    return {
      outcome: "blocked",
      reason: { type: "self_approval_forbidden", principalId: ctx.principal.principalId },
    };
  }

  // V0.1 deliberately has one Builder applicant and one human approver. Both
  // values arrive through already-trusted inputs; this guard never attests or
  // mints identity itself.
  if (metadata.requestor !== AGENT_CREATION_APPLICANT_ID) {
    return {
      outcome: "blocked",
      reason: { type: "applicant_not_builder", requestor: metadata.requestor },
    };
  }

  if (ctx.principal.principalId !== AGENT_CREATION_APPROVER_ID) {
    return {
      outcome: "blocked",
      reason: { type: "approver_not_authorized", principalId: ctx.principal.principalId },
    };
  }

  switch (policyResult.outcome) {
    case "evaluation_required": {
      const reason: DeploymentGateRejectionReason = { type: "evaluation_required" };
      return { outcome: "blocked", reason };
    }
    case "rejected": {
      const evidence: ApprovalEvidence = {
        policyOutcome: "rejected",
        rejectionReasonCodes: policyResult.reasons.map((r) => r.type),
        // Persist the held evaluation when the rejection came from one, so a
        // failed eval keeps its suite/score in the durable audit artifact.
        ...(policyResult.evaluation !== undefined
          ? {
              evaluationRef: policyResult.evaluation,
            }
          : {}),
      };
      const historyReason =
        ctx.reason ?? `deployment gate rejected (${policyResult.reasons.length} policy violation(s))`;
      return {
        outcome: "rejected",
        approval: buildApproval(candidate, metadata, ctx, "rejected", evidence),
        metadata: withTransition(metadata, "rejected", ctx, historyReason),
        reason: { type: "policy_rejected", reasons: policyResult.reasons },
      };
    }
    case "approved_pending_gate": {
      // Fail-closed cross-check: an initial/expanding verdict without held
      // evaluation evidence is inconsistent and must never be approved here,
      // even though Step 4 should already have returned `evaluation_required`.
      const evaluationRequired =
        policyResult.delta === "initial" || policyResult.delta === "capability-expanding";
      if (evaluationRequired && policyResult.evaluation === undefined) {
        return {
          outcome: "blocked",
          reason: { type: "evaluation_evidence_missing", delta: policyResult.delta },
        };
      }

      const evidence: ApprovalEvidence = {
        policyOutcome: "approved_pending_gate",
        delta: policyResult.delta,
        ...(policyResult.evaluation !== undefined
          ? {
              evaluationRef: policyResult.evaluation,
            }
          : {}),
      };
      const historyReason = ctx.reason ?? `deployment gate approved (delta: ${policyResult.delta})`;
      return {
        outcome: "approved",
        approval: buildApproval(candidate, metadata, ctx, "approved", evidence),
        metadata: withTransition(metadata, "approved", ctx, historyReason),
      };
    }
  }
}

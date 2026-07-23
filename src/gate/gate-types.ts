import type { ApprovalArtifact } from "../schema/approval-artifact.js";
import type {
  AgentSpecRuntimeMetadata,
  LifecycleState,
} from "../schema/agent-spec-runtime-metadata.js";
import type { SpecId } from "../schema/common.js";
import type { DeltaClassification } from "../invariants/classify-delta.js";
import type { PolicyRejectionReason } from "../harness/harness-types.js";
import type { VerifiedApprovalPrincipal } from "./approval-principal.js";

/**
 * Step 5 scope (Deployment Gate v0.1): consume a finished PolicyEvaluationResult
 * and turn it into approval/lifecycle artifacts. Deliberately NOT Runtime: no
 * registry, no DB, no deployment executor, and never a transition to
 * `deployed` — the gate stops at `approved`.
 */

/**
 * Injected, trusted decision context (Vertrag C). Identity and decision time
 * come from here — an already-attested principal plus a control-plane-supplied
 * timestamp and artifact id — never from builder-controlled input. Replaces the
 * earlier free-string `ApprovalRequest`; the only builder-influenceable field
 * is the optional approver `reason` note.
 */
export interface TrustedDecisionContext {
  readonly principal: VerifiedApprovalPrincipal;
  readonly decidedAt: string;
  readonly artifactId: string;
  readonly reason?: string;
}

/**
 * Why a gate run did not produce an `approved` outcome.
 * - `policy_rejected` is terminal (state -> `rejected`).
 * - all others are non-terminal blocks that leave lifecycle state untouched;
 *   the caller must fix the precondition and re-submit. `evaluation_evidence_missing`
 *   is the fail-closed cross-check: an expanding/initial verdict with no held
 *   evaluation is treated as inconsistent, never approved.
 */
export type DeploymentGateRejectionReason =
  | { readonly type: "policy_rejected"; readonly reasons: readonly PolicyRejectionReason[] }
  | { readonly type: "evaluation_required" }
  | { readonly type: "evaluation_evidence_missing"; readonly delta: DeltaClassification | "initial" }
  | { readonly type: "state_not_gateable"; readonly state: LifecycleState }
  | { readonly type: "self_approval_forbidden"; readonly principalId: string }
  | { readonly type: "subject_mismatch"; readonly specId: SpecId; readonly version: string };

/**
 * `outcome`-discriminated result (same pattern as PolicyEvaluationResult):
 * - `approved`  -> emits an ApprovalArtifact and metadata state `approved`.
 * - `rejected`  -> emits an ApprovalArtifact and metadata state `rejected`.
 * - `blocked`   -> no artifact, no state transition; a reason to act on.
 */
export type DeploymentGateResult =
  | {
      readonly outcome: "approved";
      readonly approval: ApprovalArtifact;
      readonly metadata: AgentSpecRuntimeMetadata;
    }
  | {
      readonly outcome: "rejected";
      readonly approval: ApprovalArtifact;
      readonly metadata: AgentSpecRuntimeMetadata;
      readonly reason: DeploymentGateRejectionReason;
    }
  | {
      readonly outcome: "blocked";
      readonly reason: DeploymentGateRejectionReason;
    };

import type { AgentSpecContent } from "../schema/agent-spec-content.js";
import type { SpecId, ToolId, TrustDomainId } from "../schema/common.js";
import type { TrustDomain } from "../schema/trust-domain.js";
import type {
  ApprovalEvidenceDelta,
  PolicyRejectionReasonCode,
} from "../schema/approval-artifact.js";
import type { EvaluationOutcome } from "../schema/evaluation-outcome.js";
import type { DeltaClassification } from "../invariants/classify-delta.js";

// Re-exported so existing `import { EvaluationOutcome } from "./harness-types"`
// call sites keep working now that it is a validated schema in the schema layer.
export type { EvaluationOutcome } from "../schema/evaluation-outcome.js";

/**
 * Pure/injected context (Step 4 scope, same pattern as AssemblyContext):
 * everything the harness may decide against is passed in directly. No
 * registry, no DB, no runtime. `forbiddenToolCombinations` is injected, not
 * hardcoded — the policy owner supplies it.
 */
export interface PolicyContext {
  readonly approvedSpecs: readonly AgentSpecContent[];
  readonly trustDomains: readonly TrustDomain[];
  readonly forbiddenToolCombinations: readonly (readonly ToolId[])[];
}

export type PolicyRejectionReason =
  | { readonly type: "trust_domain_not_found"; readonly trustDomainId: TrustDomainId }
  | { readonly type: "tool_not_allowed_in_domain"; readonly toolId: ToolId; readonly trustDomainId: TrustDomainId }
  | { readonly type: "role_not_allowed_in_domain"; readonly role: string; readonly trustDomainId: TrustDomainId }
  | { readonly type: "forbidden_tool_combination"; readonly toolIds: readonly ToolId[] }
  | { readonly type: "parent_version_not_found"; readonly specId: SpecId; readonly parentVersion: string }
  | { readonly type: "evaluation_outcome_invalid"; readonly suiteRef: string; readonly score: number }
  | { readonly type: "evaluation_suite_mismatch"; readonly expected: string; readonly actual: string }
  | { readonly type: "evaluation_below_threshold"; readonly score: number; readonly passThreshold: number };

/**
 * Compile-time guard that the closed reason-code catalog in the schema layer
 * and this union's `type` members stay in exact sync. Adding a reason here
 * without extending POLICY_REJECTION_REASON_CODES (or vice versa) breaks the
 * build rather than silently letting evidence codes drift.
 */
type _reasonCodesInSync =
  [PolicyRejectionReason["type"]] extends [PolicyRejectionReasonCode]
    ? [PolicyRejectionReasonCode] extends [PolicyRejectionReason["type"]]
      ? true
      : never
    : never;
const _assertReasonCodesInSync: _reasonCodesInSync = true;
void _assertReasonCodesInSync;

/**
 * Same anti-drift guard for the approved-evidence delta domain: the schema's
 * closed delta set must equal exactly `DeltaClassification | "initial"`.
 */
type _deltaInSync =
  [DeltaClassification | "initial"] extends [ApprovalEvidenceDelta]
    ? [ApprovalEvidenceDelta] extends [DeltaClassification | "initial"]
      ? true
      : never
    : never;
const _assertDeltaInSync: _deltaInSync = true;
void _assertDeltaInSync;

/**
 * Immutable identity of what was evaluated. Bound into every PolicyEvaluationResult
 * so a verdict can never be applied to a different spec/content than the one it
 * was produced for — `contentHash` is the strong binding (a version string can
 * be reused, a content hash cannot).
 */
export interface PolicySubject {
  readonly specId: SpecId;
  readonly version: string;
  readonly contentHash: string;
}

/**
 * Deliberately `outcome`-discriminated, not `success: boolean` (RoleResolution
 * pattern) — there are three distinct terminal states, not two. Every variant
 * carries the `subject` it was decided for; `approved_pending_gate` also retains
 * the `EvaluationOutcome` it was checked against (when one was involved), so the
 * downstream gate can build tamper-evident approval evidence.
 */
export type PolicyEvaluationResult =
  | {
      readonly outcome: "rejected";
      readonly subject: PolicySubject;
      readonly reasons: readonly PolicyRejectionReason[];
      // Held only when the rejection stemmed from a (schema-valid) evaluation, so
      // the audit artifact can persist the suite/score that caused it.
      readonly evaluation?: EvaluationOutcome;
    }
  | { readonly outcome: "evaluation_required"; readonly subject: PolicySubject }
  | {
      readonly outcome: "approved_pending_gate";
      readonly subject: PolicySubject;
      readonly delta: DeltaClassification | "initial";
      readonly evaluation?: EvaluationOutcome;
    };

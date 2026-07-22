import type { AgentSpecContent } from "../schema/agent-spec-content.js";
import type { SpecId, ToolId, TrustDomainId } from "../schema/common.js";
import type { TrustDomain } from "../schema/trust-domain.js";
import type { DeltaClassification } from "../invariants/classify-delta.js";

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

/**
 * A finished evaluation result, injected from outside. v0.1 never executes
 * anything itself — no dry run, no sandbox (Step 4 is explicitly not Runtime).
 */
export interface EvaluationOutcome {
  readonly suiteRef: string;
  readonly score: number;
}

export type PolicyRejectionReason =
  | { readonly type: "trust_domain_not_found"; readonly trustDomainId: TrustDomainId }
  | { readonly type: "tool_not_allowed_in_domain"; readonly toolId: ToolId; readonly trustDomainId: TrustDomainId }
  | { readonly type: "role_not_allowed_in_domain"; readonly role: string; readonly trustDomainId: TrustDomainId }
  | { readonly type: "forbidden_tool_combination"; readonly toolIds: readonly ToolId[] }
  | { readonly type: "parent_version_not_found"; readonly specId: SpecId; readonly parentVersion: string }
  | { readonly type: "evaluation_suite_mismatch"; readonly expected: string; readonly actual: string }
  | { readonly type: "evaluation_below_threshold"; readonly score: number; readonly passThreshold: number };

/**
 * Deliberately `outcome`-discriminated, not `success: boolean` (RoleResolution
 * pattern) — there are three distinct terminal states, not two.
 */
export type PolicyEvaluationResult =
  | { readonly outcome: "rejected"; readonly reasons: readonly PolicyRejectionReason[] }
  | { readonly outcome: "evaluation_required" }
  | { readonly outcome: "approved_pending_gate"; readonly delta: DeltaClassification | "initial" };

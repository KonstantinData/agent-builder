import type { AgentSpecContent } from "../schema/agent-spec-content.js";
import { classifyDelta, type DeltaClassification } from "../invariants/classify-delta.js";
import { checkTrustDomainCompliance } from "./trust-domain-check.js";
import { checkForbiddenToolCombinations } from "./forbidden-combinations.js";
import { checkEvaluationOutcome } from "./evaluation-check.js";
import type {
  EvaluationOutcome,
  PolicyContext,
  PolicyEvaluationResult,
  PolicyRejectionReason,
} from "./harness-types.js";

/**
 * Orchestrates the Step 4 policy decision. Not Runtime: never executes an
 * eval suite itself, only checks an already-finished EvaluationOutcome
 * against candidate.evalRequirements. Produces no ApprovalArtifact and no
 * lifecycle state transition — that's the Deployment Gate (Step 5).
 *
 * Deliberately out of scope for v0.1: `TrustDomain.allowedDataClasses` and
 * `crossDomainRules` are not enforced here.
 */
export function evaluatePolicy(
  candidate: AgentSpecContent,
  context: PolicyContext,
  evalOutcome?: EvaluationOutcome,
): PolicyEvaluationResult {
  const reasons: PolicyRejectionReason[] = [
    ...checkTrustDomainCompliance(candidate, context.trustDomains),
    ...checkForbiddenToolCombinations(candidate, context.forbiddenToolCombinations),
  ];

  let parent: AgentSpecContent | undefined;
  if (candidate.parentVersion !== null) {
    parent = context.approvedSpecs.find(
      (spec) => spec.specId === candidate.specId && spec.version === candidate.parentVersion,
    );
    if (!parent) {
      reasons.push({
        type: "parent_version_not_found",
        specId: candidate.specId,
        parentVersion: candidate.parentVersion,
      });
    }
  }

  if (reasons.length > 0) {
    return { outcome: "rejected", reasons };
  }

  // A brand-new spec always needs evaluation, no exception for
  // "simple"/small specs (Section 12: no skip for "simple agents").
  const delta: DeltaClassification | "initial" =
    candidate.parentVersion === null
      ? "initial"
      : classifyDelta(parent as AgentSpecContent, candidate); // parentVersion !== null and reasons.length === 0 above guarantee parent was found

  const evaluationNeeded = delta === "initial" || delta === "capability-expanding";

  // A supplied evalOutcome is always checked, even when this delta type
  // wouldn't have required one. A known failing/mismatched result must never
  // be silently discarded just because evaluation wasn't strictly mandatory
  // — that would let a caller pass in a known-bad outcome and still get
  // approved_pending_gate.
  if (evalOutcome) {
    const evalReasons = checkEvaluationOutcome(candidate, evalOutcome);
    if (evalReasons.length > 0) {
      return { outcome: "rejected", reasons: evalReasons };
    }
    return { outcome: "approved_pending_gate", delta };
  }

  if (evaluationNeeded) {
    return { outcome: "evaluation_required" };
  }

  return { outcome: "approved_pending_gate", delta };
}

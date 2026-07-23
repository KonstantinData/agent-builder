import type { AgentSpecContent } from "../schema/agent-spec-content.js";
import { classifyDelta, type DeltaClassification } from "../invariants/classify-delta.js";
import { checkTrustDomainCompliance } from "./trust-domain-check.js";
import { checkForbiddenToolCombinations } from "./forbidden-combinations.js";
import { checkEvaluationOutcome } from "./evaluation-check.js";
import { EvaluationOutcomeSchema } from "../schema/evaluation-outcome.js";
import type {
  EvaluationOutcome,
  PolicyContext,
  PolicyEvaluationResult,
  PolicyRejectionReason,
  PolicySubject,
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
  // Bind the verdict to exactly this spec/content up front, so every return
  // path below carries an immutable subject the deployment gate can verify.
  const subject: PolicySubject = {
    specId: candidate.specId,
    version: candidate.version,
    contentHash: candidate.contentHash,
  };

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
    return { outcome: "rejected", subject, reasons };
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
    // Fail-closed: a schema-invalid outcome (NaN/out-of-range score, empty
    // suiteRef) is rejected structurally — never trusted into the
    // `score < passThreshold` comparison, never retained as evidence.
    if (!EvaluationOutcomeSchema.safeParse(evalOutcome).success) {
      return {
        outcome: "rejected",
        subject,
        reasons: [
          { type: "evaluation_outcome_invalid", suiteRef: evalOutcome.suiteRef, score: evalOutcome.score },
        ],
      };
    }
    const evalReasons = checkEvaluationOutcome(candidate, evalOutcome);
    if (evalReasons.length > 0) {
      // Retain the (valid) outcome that caused the rejection as held evidence.
      return { outcome: "rejected", subject, reasons: evalReasons, evaluation: evalOutcome };
    }
    // Retain the outcome that was actually checked as held evidence.
    return { outcome: "approved_pending_gate", subject, delta, evaluation: evalOutcome };
  }

  if (evaluationNeeded) {
    return { outcome: "evaluation_required", subject };
  }

  return { outcome: "approved_pending_gate", subject, delta };
}

import type { AgentSpecContent } from "../schema/agent-spec-content.js";
import type { EvaluationOutcome, PolicyRejectionReason } from "./harness-types.js";

/**
 * Pure threshold comparison against an already-finished result — no
 * execution, no sandbox (Step 4 is explicitly not Runtime).
 *
 * Suite mismatch and threshold are NOT independent dimensions like the checks
 * in evaluate-policy.ts: a score against the wrong suite says nothing about
 * the real threshold, so a mismatch short-circuits before the score is even
 * considered.
 */
export function checkEvaluationOutcome(
  candidate: AgentSpecContent,
  evalOutcome: EvaluationOutcome,
): PolicyRejectionReason[] {
  if (evalOutcome.suiteRef !== candidate.evalRequirements.suiteRef) {
    return [
      {
        type: "evaluation_suite_mismatch",
        expected: candidate.evalRequirements.suiteRef,
        actual: evalOutcome.suiteRef,
      },
    ];
  }
  if (evalOutcome.score < candidate.evalRequirements.passThreshold) {
    return [
      {
        type: "evaluation_below_threshold",
        score: evalOutcome.score,
        passThreshold: candidate.evalRequirements.passThreshold,
      },
    ];
  }
  return [];
}

import {
  GUIDED_BRIEFING_TOPICS,
  GuidedBriefingSchema,
  type GuidedBriefing,
  type GuidedBriefingTopic,
} from "../schema/guided-briefing.js";

export type BriefingReadinessReason =
  | { readonly type: "schema_validation_failed" }
  | { readonly type: "briefing_not_completed" }
  | { readonly type: "unanswered_question"; readonly questionId: string }
  | { readonly type: "missing_topic_coverage"; readonly topic: GuidedBriefingTopic };

export type BriefingReadinessResult =
  | { readonly ready: true; readonly briefing: GuidedBriefing }
  | { readonly ready: false; readonly reasons: readonly BriefingReadinessReason[] };

/**
 * Checks the Builder-side start gate for a contextual briefing. The topic
 * catalog is a completeness framework only: it does not prescribe a question
 * wording, count, or order. This pure function does not assemble, approve,
 * package, deploy, or execute an agent.
 */
export function evaluateGuidedBriefingReadiness(candidate: unknown): BriefingReadinessResult {
  const parsed = GuidedBriefingSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ready: false, reasons: [{ type: "schema_validation_failed" }] };
  }

  const briefing = parsed.data;
  const reasons: BriefingReadinessReason[] = [];

  if (briefing.status !== "completed") {
    reasons.push({ type: "briefing_not_completed" });
  }

  const answersByQuestionId = new Set(briefing.answers.map((answer) => answer.questionId));
  for (const question of briefing.questions) {
    if (!answersByQuestionId.has(question.questionId)) {
      reasons.push({ type: "unanswered_question", questionId: question.questionId });
    }
  }

  for (const topic of GUIDED_BRIEFING_TOPICS) {
    const hasQuestion = briefing.questions.some((question) => question.topic === topic);
    const hasAnswer = briefing.answers.some((answer) => answer.topic === topic);
    if (!hasQuestion || !hasAnswer) {
      reasons.push({ type: "missing_topic_coverage", topic });
    }
  }

  return reasons.length === 0 ? { ready: true, briefing } : { ready: false, reasons };
}

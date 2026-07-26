import { z } from "zod";

/**
 * These topics are an internal completeness framework. They deliberately do
 * not define a fixed questionnaire: a briefing may ask any number of
 * agent-specific questions in any order.
 */
export const GUIDED_BRIEFING_TOPICS = [
  "workflow_and_outcome",
  "required_information",
  "allowed_systems",
  "decision_boundaries",
  "output_and_tone",
  "tests_and_acceptance",
] as const;

export const GuidedBriefingTopicSchema = z.enum(GUIDED_BRIEFING_TOPICS);
export type GuidedBriefingTopic = z.infer<typeof GuidedBriefingTopicSchema>;

export const BriefingQuestionSchema = z
  .object({
    questionId: z.string().min(1),
    topic: GuidedBriefingTopicSchema,
    prompt: z.string().min(1),
    rationale: z.string().min(1),
  })
  .strict();
export type BriefingQuestion = z.infer<typeof BriefingQuestionSchema>;

/**
 * Briefings retain only a sanitised requirement summary. They must not retain
 * customer records, customer configuration, credentials, or server access
 * data in the Builder repository.
 */
export const BriefingAnswerSchema = z
  .object({
    questionId: z.string().min(1),
    topic: GuidedBriefingTopicSchema,
    sanitizedSummary: z.string().min(1),
    sourceClassification: z.enum(["generic_requirement", "redacted_customer_detail"]),
  })
  .strict();
export type BriefingAnswer = z.infer<typeof BriefingAnswerSchema>;

export const GuidedBriefingSchema = z
  .object({
    briefingId: z.string().min(1),
    roughRequest: z.string().min(1),
    questions: z.array(BriefingQuestionSchema),
    answers: z.array(BriefingAnswerSchema),
    planSummary: z.string().min(1),
    status: z.enum(["in_progress", "completed"]),
  })
  .strict()
  .superRefine((briefing, context) => {
    const questionIds = new Set<string>();
    for (const [index, question] of briefing.questions.entries()) {
      if (questionIds.has(question.questionId)) {
        context.addIssue({
          code: "custom",
          path: ["questions", index, "questionId"],
          message: "questionId must be unique within a briefing",
        });
      }
      questionIds.add(question.questionId);
    }

    const answeredQuestionIds = new Set<string>();
    for (const [index, answer] of briefing.answers.entries()) {
      const question = briefing.questions.find((entry) => entry.questionId === answer.questionId);
      if (question === undefined) {
        context.addIssue({
          code: "custom",
          path: ["answers", index, "questionId"],
          message: "answer must reference a question in the same briefing",
        });
        continue;
      }
      if (answeredQuestionIds.has(answer.questionId)) {
        context.addIssue({
          code: "custom",
          path: ["answers", index, "questionId"],
          message: "a question may have only one retained answer",
        });
      }
      answeredQuestionIds.add(answer.questionId);
      if (question.topic !== answer.topic) {
        context.addIssue({
          code: "custom",
          path: ["answers", index, "topic"],
          message: "answer topic must match its question topic",
        });
      }
    }
  });
export type GuidedBriefing = z.infer<typeof GuidedBriefingSchema>;

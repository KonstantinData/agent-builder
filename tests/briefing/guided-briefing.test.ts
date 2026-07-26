import { describe, expect, it } from "vitest";
import { evaluateGuidedBriefingReadiness } from "../../src/briefing/guided-briefing.js";
import { GuidedBriefingSchema, type GuidedBriefing } from "../../src/schema/guided-briefing.js";

const questions = [
  ["workflow_and_outcome", "What outcome should the agent produce?"],
  ["required_information", "Which information is needed?"],
  ["allowed_systems", "Which systems may it use?"],
  ["decision_boundaries", "Which decisions require escalation?"],
  ["output_and_tone", "How should its result read?"],
  ["tests_and_acceptance", "What proves acceptance?"],
] as const;

function completedBriefing(): GuidedBriefing {
  return {
    briefingId: "briefing-lead-intake-001",
    roughRequest: "Build a lead-intake agent.",
    questions: questions.map(([topic, prompt], index) => ({
      questionId: `question-${index + 1}`,
      topic,
      prompt,
      rationale: "Needed to produce a complete, agent-specific plan.",
    })),
    answers: questions.map(([topic], index) => ({
      questionId: `question-${index + 1}`,
      topic,
      sanitizedSummary: "A non-customer-specific requirement summary.",
      sourceClassification: "generic_requirement",
    })),
    planSummary: "A complete plan for a lead-intake agent.",
    status: "completed",
  };
}

describe("guided contextual briefing", () => {
  it("accepts a completed briefing with flexible, topic-specific questions", () => {
    const candidate = completedBriefing();
    expect(GuidedBriefingSchema.safeParse(candidate).success).toBe(true);
    expect(evaluateGuidedBriefingReadiness(candidate)).toMatchObject({ ready: true });
  });

  it("does not prescribe a fixed question wording or a single question per topic", () => {
    const candidate = completedBriefing();
    candidate.questions.push({
      questionId: "question-7",
      topic: "decision_boundaries",
      prompt: "Which unusual cases should be passed to a person?",
      rationale: "The rough request indicates an exception path.",
    });
    candidate.answers.push({
      questionId: "question-7",
      topic: "decision_boundaries",
      sanitizedSummary: "Unusual exceptions require a human decision.",
      sourceClassification: "generic_requirement",
    });
    expect(evaluateGuidedBriefingReadiness(candidate)).toMatchObject({ ready: true });
  });

  it("blocks build readiness when a completeness topic is missing", () => {
    const candidate = completedBriefing();
    candidate.questions = candidate.questions.filter((question) => question.topic !== "tests_and_acceptance");
    candidate.answers = candidate.answers.filter((answer) => answer.topic !== "tests_and_acceptance");
    expect(evaluateGuidedBriefingReadiness(candidate)).toMatchObject({
      ready: false,
      reasons: expect.arrayContaining([{ type: "missing_topic_coverage", topic: "tests_and_acceptance" }]),
    });
  });

  it("blocks build readiness until every asked question is answered and the dialogue is completed", () => {
    const candidate = completedBriefing();
    candidate.status = "in_progress";
    candidate.answers = candidate.answers.filter((answer) => answer.questionId !== "question-1");
    expect(evaluateGuidedBriefingReadiness(candidate)).toMatchObject({
      ready: false,
      reasons: expect.arrayContaining([
        { type: "briefing_not_completed" },
        { type: "unanswered_question", questionId: "question-1" },
      ]),
    });
  });

  it("rejects mismatched, duplicate, or foreign answer references", () => {
    const candidate = completedBriefing();
    const firstAnswer = candidate.answers[0];
    const secondAnswer = candidate.answers[1];
    if (firstAnswer === undefined || secondAnswer === undefined) {
      throw new Error("fixture must include briefing answers");
    }
    candidate.answers[0] = { ...firstAnswer, topic: "allowed_systems" };
    candidate.answers.push({ ...secondAnswer });
    candidate.answers.push({
      questionId: "unknown-question",
      topic: "workflow_and_outcome",
      sanitizedSummary: "Not linked to this briefing.",
      sourceClassification: "generic_requirement",
    });
    expect(GuidedBriefingSchema.safeParse(candidate).success).toBe(false);
  });
});

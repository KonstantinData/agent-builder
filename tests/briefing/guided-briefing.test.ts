import { describe, expect, it } from "vitest";
import { answerGuidedBriefing, completeGuidedBriefing, evaluateCompletedGuidedBriefingFlowReadiness, evaluateGuidedBriefingReadiness, startGuidedBriefing } from "../../src/briefing/guided-briefing.js";
import { GuidedBriefingSchema, type GuidedBriefing } from "../../src/schema/guided-briefing.js";

const questions = [
  ["workflow_and_outcome", "What outcome should the agent produce?"],
  ["required_information", "Which information is needed?"],
  ["allowed_systems", "Which systems may it use?"],
  ["decision_boundaries", "Which decisions require escalation?"],
  ["output_and_tone", "How should its result read?"],
  ["tests_and_acceptance", "What proves acceptance?"],
] as const;
const signer = { sign: (digest: string) => `trusted:${digest}`, verify: (digest: string, signature: string) => signature === `trusted:${digest}` };

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
  it("executes rough request to contextual questions, answers, and a completed plan", () => {
    const roughRequest = "Build a lead-intake agent.";
    let flow = startGuidedBriefing({ briefingId: "flow-1", roughRequest, signer, questionProvider: { questionsFor: ({ missingTopics }) => missingTopics.map((topic, index) => ({ question: { questionId: `flow-${index}`, topic, prompt: `What is needed for ${topic}?`, rationale: `Required for ${roughRequest}` }, contextNeed: "lead-intake outcome" })) } });
    for (const question of flow.briefing.questions) flow = answerGuidedBriefing(flow, { questionId: question.questionId, topic: question.topic, sanitizedSummary: "Generic requirement.", sourceClassification: "generic_requirement" }, signer);
    const complete = completeGuidedBriefing(flow, { planFor: ({ briefing, flowDigest }) => ({ planSummary: `Plan for ${briefing.roughRequest}`, flowDigest }) }, signer);
    expect(complete.briefing.status).toBe("completed"); expect(complete.briefing.planSummary).toBe(`Plan for ${roughRequest}`); expect(evaluateCompletedGuidedBriefingFlowReadiness(complete, signer)).toMatchObject({ ready: true });
    expect(evaluateCompletedGuidedBriefingFlowReadiness({ ...complete, contextNeeds: {} }, signer)).toMatchObject({ ready: false });
    expect(evaluateCompletedGuidedBriefingFlowReadiness({ ...complete, signature: "forged" }, signer)).toMatchObject({ ready: false });
  });

  it("rejects unrelated questions, foreign answers, and completion before all answers", () => {
    const roughRequest = "Build a lead-intake agent.";
    expect(() => startGuidedBriefing({ briefingId: "bad", roughRequest, signer, questionProvider: { questionsFor: () => [{ question: { questionId: "q", topic: "workflow_and_outcome", prompt: "What?", rationale: "Generic." }, contextNeed: "generic need" }] } })).toThrow("non-contextual");
    const flow = startGuidedBriefing({ briefingId: "flow-2", roughRequest, signer, questionProvider: { questionsFor: ({ missingTopics }) => missingTopics.map((topic, index) => ({ question: { questionId: `q-${index}`, topic, prompt: "Question", rationale: roughRequest }, contextNeed: "lead-intake need" })) } });
    expect(() => answerGuidedBriefing(flow, { questionId: "foreign", topic: "workflow_and_outcome", sanitizedSummary: "No.", sourceClassification: "generic_requirement" }, signer)).toThrow("not eligible");
    expect(() => completeGuidedBriefing(flow, { planFor: ({ flowDigest }) => ({ planSummary: "Plan", flowDigest }) }, signer)).toThrow("not ready");
    expect(() => completeGuidedBriefing({ ...flow, briefing: { ...flow.briefing, roughRequest: "Replaced request." } }, { planFor: ({ flowDigest }) => ({ planSummary: "Plan", flowDigest }) }, signer)).toThrow("state was modified");
  });

  it("rejects a fabricated completed briefing and a plan with a foreign flow digest", () => {
    expect(evaluateCompletedGuidedBriefingFlowReadiness(completedBriefing(), signer)).toMatchObject({ ready: false });
    const roughRequest = "Build a lead-intake agent."; let flow = startGuidedBriefing({ briefingId: "flow-3", roughRequest, signer, questionProvider: { questionsFor: ({ missingTopics }) => missingTopics.map((topic, index) => ({ question: { questionId: `q-${index}`, topic, prompt: "Question", rationale: roughRequest }, contextNeed: "lead-intake need" })) } });
    for (const question of flow.briefing.questions) flow = answerGuidedBriefing(flow, { questionId: question.questionId, topic: question.topic, sanitizedSummary: "Generic requirement.", sourceClassification: "generic_requirement" }, signer);
    expect(() => completeGuidedBriefing(flow, { planFor: () => ({ planSummary: "Foreign plan", flowDigest: "0".repeat(64) }) }, signer)).toThrow("not bound");
  });
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

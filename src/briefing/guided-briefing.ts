import {
  GUIDED_BRIEFING_TOPICS,
  BriefingAnswerSchema,
  BriefingQuestionSchema,
  GuidedBriefingSchema,
  type GuidedBriefing,
  type BriefingAnswer,
  type BriefingQuestion,
  type GuidedBriefingTopic,
} from "../schema/guided-briefing.js";
import { createHash } from "node:crypto";

export type BriefingReadinessReason =
  | { readonly type: "schema_validation_failed" }
  | { readonly type: "briefing_not_completed" }
  | { readonly type: "unanswered_question"; readonly questionId: string }
  | { readonly type: "missing_topic_coverage"; readonly topic: GuidedBriefingTopic };

export type BriefingReadinessResult =
  | { readonly ready: true; readonly briefing: GuidedBriefing }
  | { readonly ready: false; readonly reasons: readonly BriefingReadinessReason[] };

export interface ContextualQuestionProvider {
  readonly questionsFor: (request: { readonly roughRequest: string; readonly missingTopics: readonly GuidedBriefingTopic[] }) => readonly ContextualBriefingQuestion[];
}

export interface BriefingPlanProvider {
  readonly planFor: (flow: GuidedBriefingFlow) => { readonly planSummary: string; readonly flowDigest: string };
}

export interface ContextualBriefingQuestion { readonly question: BriefingQuestion; readonly contextNeed: string; }
export interface FlowSigner { readonly sign: (flowDigest: string) => string; readonly verify: (flowDigest: string, signature: string) => boolean; }
export interface GuidedBriefingFlow { readonly briefing: GuidedBriefing; readonly contextNeeds: Readonly<Record<string, string>>; readonly flowDigest: string; readonly signature: string; }
export interface CompletedGuidedBriefingFlow { readonly briefing: GuidedBriefing; readonly contextNeeds: Readonly<Record<string, string>>; readonly flowDigest: string; readonly signature: string; readonly planInputDigest: string; }

function digestFlow(briefing: GuidedBriefing, contextNeeds: Readonly<Record<string, string>>): string {
  return createHash("sha256").update(JSON.stringify({ roughRequest: briefing.roughRequest, questions: briefing.questions, answers: briefing.answers, contextNeeds })).digest("hex");
}

function validateFlow(flow: GuidedBriefingFlow, signer: FlowSigner): void {
  if (flow.flowDigest !== digestFlow(flow.briefing, flow.contextNeeds) || !signer.verify(flow.flowDigest, flow.signature)) throw new TypeError("briefing flow state was modified or unauthenticated");
}

/** Starts a deterministic contextual flow from only a rough request. */
export function startGuidedBriefing(input: { readonly briefingId: string; readonly roughRequest: string; readonly questionProvider: ContextualQuestionProvider; readonly signer: FlowSigner }): GuidedBriefingFlow {
  if (input.roughRequest.trim().length === 0) throw new TypeError("rough request is required");
  const generated = input.questionProvider.questionsFor({ roughRequest: input.roughRequest, missingTopics: GUIDED_BRIEFING_TOPICS }); const questions = generated.map((entry) => entry.question);
  const requestTokens = new Set(input.roughRequest.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
  if (questions.length === 0 || generated.some((entry) => BriefingQuestionSchema.safeParse(entry.question).success === false || entry.contextNeed.trim().length === 0 || !(entry.contextNeed.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).some((token) => requestTokens.has(token)))) throw new TypeError("contextual question provider returned non-contextual questions");
  if (new Set(questions.map((question) => question.questionId)).size !== questions.length) throw new TypeError("contextual question provider returned duplicate questions");
  const briefing = { briefingId: input.briefingId, roughRequest: input.roughRequest, questions: [...questions], answers: [], planSummary: "Pending contextual answers.", status: "in_progress" as const };
  const contextNeeds = Object.fromEntries(generated.map((entry) => [entry.question.questionId, entry.contextNeed]));
  const flowDigest = digestFlow(briefing, contextNeeds); return { briefing, contextNeeds, flowDigest, signature: input.signer.sign(flowDigest) };
}

/** Records exactly one sanitized answer for a question issued in this flow. */
export function answerGuidedBriefing(flow: GuidedBriefingFlow, answer: BriefingAnswer, signer: FlowSigner): GuidedBriefingFlow {
  validateFlow(flow, signer); const briefing = flow.briefing;
  const parsed = BriefingAnswerSchema.safeParse(answer); if (!parsed.success) throw new TypeError("invalid briefing answer");
  const question = briefing.questions.find((entry) => entry.questionId === parsed.data.questionId);
  if (question === undefined || question.topic !== parsed.data.topic || briefing.answers.some((entry) => entry.questionId === parsed.data.questionId)) throw new TypeError("answer is not eligible for this briefing");
  const nextBriefing = { ...briefing, answers: [...briefing.answers, parsed.data] };
  const flowDigest = digestFlow(nextBriefing, flow.contextNeeds); return { ...flow, briefing: nextBriefing, flowDigest, signature: signer.sign(flowDigest) };
}

/** Completes the plan only from the questions and answers issued by this flow. */
export function completeGuidedBriefing(flow: GuidedBriefingFlow, planProvider: BriefingPlanProvider, signer: FlowSigner): CompletedGuidedBriefingFlow {
  validateFlow(flow, signer); const pending = { ...flow.briefing, status: "completed" as const };
  const readiness = evaluateGuidedBriefingReadiness(pending);
  if (!readiness.ready) throw new TypeError("briefing is not ready to complete");
  const completionDigest = digestFlow(pending, flow.contextNeeds); const completionFlow = { ...flow, briefing: pending, flowDigest: completionDigest, signature: signer.sign(completionDigest) }; const plan = planProvider.planFor(completionFlow);
  if (plan.planSummary.trim().length === 0 || plan.flowDigest !== completionFlow.flowDigest) throw new TypeError("briefing plan is not bound to this flow");
  const planSummary = plan.planSummary;
  const completedBriefing = { ...pending, planSummary };
  const flowDigest = digestFlow(completedBriefing, flow.contextNeeds); return { briefing: completedBriefing, contextNeeds: flow.contextNeeds, flowDigest, signature: signer.sign(flowDigest), planInputDigest: completionFlow.flowDigest };
}

/** The only Build-start briefing gate: it accepts a completed flow artifact, never a free-form briefing. */
export function evaluateCompletedGuidedBriefingFlowReadiness(candidate: unknown, signer: FlowSigner): BriefingReadinessResult {
  if (candidate === null || typeof candidate !== "object") return { ready: false, reasons: [{ type: "schema_validation_failed" }] };
  const completed = candidate as Partial<CompletedGuidedBriefingFlow>;
  if (completed.briefing === undefined || completed.contextNeeds === undefined || typeof completed.flowDigest !== "string" || typeof completed.signature !== "string" || typeof completed.planInputDigest !== "string") return { ready: false, reasons: [{ type: "schema_validation_failed" }] };
  const contextNeeds = completed.contextNeeds;
  const briefing = GuidedBriefingSchema.safeParse(completed.briefing);
  if (!briefing.success || briefing.data.status !== "completed" || Object.keys(contextNeeds).length !== briefing.data.questions.length || briefing.data.questions.some((question) => { const need = contextNeeds[question.questionId]; return typeof need !== "string" || need.trim().length === 0; }) || completed.flowDigest !== digestFlow(briefing.data, contextNeeds) || !signer.verify(completed.flowDigest, completed.signature)) return { ready: false, reasons: [{ type: "schema_validation_failed" }] };
  const planInput = { ...briefing.data, planSummary: "Pending contextual answers." };
  if (completed.planInputDigest !== digestFlow(planInput, completed.contextNeeds)) return { ready: false, reasons: [{ type: "schema_validation_failed" }] };
  return evaluateGuidedBriefingReadiness(briefing.data);
}

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

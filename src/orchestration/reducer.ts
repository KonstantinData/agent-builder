import { z } from "zod";
import { domainSeparatedDigest } from "./canonical-json.js";
import {
  DigestSchema,
  IdentifierSchema,
  LockedStepContractV1Schema,
  ModelRoutingDecisionV1Schema,
  Rfc3339InstantSchema,
  RunStartEvidenceV1Schema,
  RunIntentV1Schema,
  computeLockedContractDigest,
  verifyRunIntentDigest,
  type LockedStepContractV1,
  type ModelRoutingDecisionV1,
  type RunIntentV1,
} from "./contracts.js";
import { validateModelRoutingDecision } from "./model-routing.js";

export const ORCHESTRATION_PHASES = [
  "intent_verified",
  "repository_inspected",
  "step_selected",
  "contract_negotiating",
  "contract_locked",
  "implementation_pending",
  "implementation_complete",
  "verification_pending",
  "verified",
  "branch_push_pending",
  "branch_pushed",
  "pr_create_pending",
  "pr_open",
  "ci_pending",
  "ci_passed",
  "merge_ready",
  "merge_pending",
  "merged",
  "cleanup_pending",
  "step_complete",
  "completed",
  "stopped",
] as const;
export const OrchestrationPhaseSchema = z.enum(ORCHESTRATION_PHASES);
export type OrchestrationPhase = z.infer<typeof OrchestrationPhaseSchema>;

export const STOP_REASONS = [
  "corruption_detected",
  "intent_missing",
  "intent_unverifiable",
  "intent_expired",
  "intent_base_mismatch",
  "intent_scope_violation",
  "intent_budget_exhausted",
  "verifier_unavailable",
  "driver_unavailable",
  "driver_untrusted",
  "adapter_unavailable",
  "governance_touch",
  "deploy_on_main_detected",
  "merge_authority_missing",
  "merge_readback_failed",
  "push_readback_failed",
  "roadmap_history_unverified",
  "roadmap_zero_eligible",
  "roadmap_multiple_eligible",
  "roadmap_dependency_unmerged",
  "roadmap_base_mismatch",
  "roadmap_unknown_expansion",
  "roadmap_class_not_allowed",
  "human_flag_required",
  "model_route_unavailable",
  "model_route_policy_violation",
  "contract_conflict",
  "contract_malformed",
  "contract_digest_mismatch",
  "contract_scope_expansion",
  "claude_round_exhausted",
  "claude_timeout",
  "attempt_exhausted",
  "phase_timeout",
  "adapter_error",
  "readback_inconclusive",
  "budget_exhausted_run",
  "budget_exhausted_step",
  "unknown_event",
  "unknown_state_transition",
] as const;
export const StopReasonSchema = z.enum(STOP_REASONS);
export type StopReason = z.infer<typeof StopReasonSchema>;

const AttemptCountersSchema = z.record(z.string(), z.number().int().nonnegative());

export const OrchestrationSnapshotV1Schema = z
  .object({
    schemaVersion: z.literal("orchestration-snapshot/1"),
    runId: IdentifierSchema,
    phase: OrchestrationPhaseSchema,
    intent: RunIntentV1Schema,
    startEvidence: RunStartEvidenceV1Schema.nullable(),
    currentStepId: IdentifierSchema.nullable(),
    contract: LockedStepContractV1Schema.nullable(),
    routingDecision: ModelRoutingDecisionV1Schema.nullable(),
    stepsConsumed: z.number().int().nonnegative(),
    claudeRoundsConsumed: z.record(z.string(), z.number().int().nonnegative()),
    sideEffectAttemptsConsumed: AttemptCountersSchema,
    lastSequence: z.number().int().nonnegative(),
    lastEventDigest: DigestSchema.nullable(),
    stopReason: StopReasonSchema.nullable(),
    snapshotDigest: DigestSchema,
  })
  .strict();
export type OrchestrationSnapshotV1 = z.infer<typeof OrchestrationSnapshotV1Schema>;

export const OrchestrationEventKindSchema = z.enum([
  "RepositoryInspected",
  "StepSelected",
  "NegotiationOpened",
  "ContractProposalRecorded",
  "ContractLocked",
  "ImplementationDispatched",
  "ImplementationClaimed",
  "VerificationDispatched",
  "VerificationPassed",
  "BranchPushDispatched",
  "BranchPushReadback",
  "PrCreateDispatched",
  "PrOpenReadback",
  "CiWaitStarted",
  "CiReadback",
  "MergeGateEvaluated",
  "MergeDispatched",
  "MergeReadback",
  "CleanupDispatched",
  "StepCompleted",
  "RunCompleted",
  "StoppedForCause",
]);
export type OrchestrationEventKind = z.infer<typeof OrchestrationEventKindSchema>;

export const OrchestrationEventV1Schema = z
  .object({
    schemaVersion: z.literal("orchestration-event/1"),
    eventId: IdentifierSchema,
    runId: IdentifierSchema,
    sequence: z.number().int().positive(),
    observedAt: Rfc3339InstantSchema,
    kind: OrchestrationEventKindSchema,
    payload: z.record(z.string(), z.unknown()),
    payloadDigest: DigestSchema,
    previousEventDigest: DigestSchema.nullable(),
    eventDigest: DigestSchema,
  })
  .strict();
export type OrchestrationEventV1 = z.infer<typeof OrchestrationEventV1Schema>;

export const RepositoryInspectionResultV1Schema = z
  .object({
    evidenceDigest: DigestSchema,
    originMainSha: z.string().regex(/^[0-9a-f]{40}$/),
    attendedLocal: z.literal(true),
    deploysOnMain: z.literal(false),
    defaultBranchProtected: z.literal(true),
    roadmapHistoryVerified: z.literal(true),
  })
  .strict();

export const VerificationResultV1Schema = z
  .object({
    typecheckPassed: z.literal(true),
    testsPassed: z.literal(true),
    diffWithinContract: z.literal(true),
    touchesGovernance: z.literal(false),
    capabilityExpanded: z.literal(false),
    deploymentChanged: z.literal(false),
  })
  .strict();

export const MergeGateEvidenceV1Schema = z
  .object({
    exactHeadVerified: z.literal(true),
    baseCompatible: z.literal(true),
    requiredChecksPassed: z.literal(true),
    reviewPolicySatisfied: z.literal(true),
    deploysOnMain: z.literal(false),
    githubWorkflowChanged: z.literal(false),
    diffWithinContract: z.literal(true),
    defaultBranchProtected: z.literal(true),
    pullRequestOpenAndMergeable: z.literal(true),
  })
  .strict();

function snapshotPayload(snapshot: Omit<OrchestrationSnapshotV1, "snapshotDigest">): unknown {
  return snapshot;
}

function withSnapshotDigest(snapshot: Omit<OrchestrationSnapshotV1, "snapshotDigest">): OrchestrationSnapshotV1 {
  return OrchestrationSnapshotV1Schema.parse({
    ...snapshot,
    snapshotDigest: domainSeparatedDigest("agent-builder/orchestration/snapshot/v1", snapshotPayload(snapshot)),
  });
}

export function verifySnapshotDigest(snapshotInput: OrchestrationSnapshotV1): boolean {
  const snapshot = OrchestrationSnapshotV1Schema.parse(snapshotInput);
  const { snapshotDigest, ...payload } = snapshot;
  return snapshotDigest === domainSeparatedDigest("agent-builder/orchestration/snapshot/v1", payload);
}

export function createVerifiedRunSnapshot(
  runId: string,
  intent: RunIntentV1,
  startEvidence: z.infer<typeof RunStartEvidenceV1Schema> | null = null,
): OrchestrationSnapshotV1 {
  if (!verifyRunIntentDigest(intent)) {
    throw new TypeError("verified run intent digest does not match canonical intent bytes");
  }
  return withSnapshotDigest({
    schemaVersion: "orchestration-snapshot/1",
    runId,
    phase: "intent_verified",
    intent: RunIntentV1Schema.parse(intent),
    startEvidence: startEvidence === null ? null : RunStartEvidenceV1Schema.parse(startEvidence),
    currentStepId: null,
    contract: null,
    routingDecision: null,
    stepsConsumed: 0,
    claudeRoundsConsumed: {},
    sideEffectAttemptsConsumed: {},
    lastSequence: 0,
    lastEventDigest: null,
    stopReason: null,
  });
}

export function createOrchestrationEvent(input: {
  readonly eventId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly observedAt: string;
  readonly kind: OrchestrationEventKind;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly previousEventDigest: string | null;
}): OrchestrationEventV1 {
  const payload = input.payload ?? {};
  const payloadDigest = domainSeparatedDigest("agent-builder/orchestration/event-payload/v1", payload);
  const base = {
    schemaVersion: "orchestration-event/1" as const,
    eventId: input.eventId,
    runId: input.runId,
    sequence: input.sequence,
    observedAt: input.observedAt,
    kind: input.kind,
    payload,
    payloadDigest,
    previousEventDigest: input.previousEventDigest,
  };
  return OrchestrationEventV1Schema.parse({
    ...base,
    eventDigest: domainSeparatedDigest("agent-builder/orchestration/event/v1", base),
  });
}

const TRANSITIONS: Readonly<Partial<Record<OrchestrationEventKind, readonly OrchestrationPhase[]>>> = Object.freeze({
  RepositoryInspected: ["intent_verified", "step_complete"],
  StepSelected: ["repository_inspected"],
  NegotiationOpened: ["step_selected", "contract_negotiating"],
  ContractProposalRecorded: ["contract_negotiating"],
  ContractLocked: ["contract_negotiating"],
  ImplementationDispatched: ["contract_locked"],
  ImplementationClaimed: ["implementation_pending"],
  VerificationDispatched: ["implementation_complete"],
  VerificationPassed: ["verification_pending"],
  BranchPushDispatched: ["verified"],
  BranchPushReadback: ["branch_push_pending"],
  PrCreateDispatched: ["branch_pushed"],
  PrOpenReadback: ["pr_create_pending"],
  CiWaitStarted: ["pr_open"],
  CiReadback: ["ci_pending"],
  MergeGateEvaluated: ["ci_passed"],
  MergeDispatched: ["merge_ready"],
  MergeReadback: ["merge_pending"],
  CleanupDispatched: ["merged"],
  StepCompleted: ["cleanup_pending"],
  RunCompleted: ["repository_inspected", "step_complete"],
  StoppedForCause: ORCHESTRATION_PHASES.filter((phase) => phase !== "completed" && phase !== "stopped"),
});

const NEXT_PHASE: Readonly<Record<Exclude<OrchestrationEventKind, "ContractProposalRecorded" | "StoppedForCause">, OrchestrationPhase>> = Object.freeze({
  RepositoryInspected: "repository_inspected",
  StepSelected: "step_selected",
  NegotiationOpened: "contract_negotiating",
  ContractLocked: "contract_locked",
  ImplementationDispatched: "implementation_pending",
  ImplementationClaimed: "implementation_complete",
  VerificationDispatched: "verification_pending",
  VerificationPassed: "verified",
  BranchPushDispatched: "branch_push_pending",
  BranchPushReadback: "branch_pushed",
  PrCreateDispatched: "pr_create_pending",
  PrOpenReadback: "pr_open",
  CiWaitStarted: "ci_pending",
  CiReadback: "ci_passed",
  MergeGateEvaluated: "merge_ready",
  MergeDispatched: "merge_pending",
  MergeReadback: "merged",
  CleanupDispatched: "cleanup_pending",
  StepCompleted: "step_complete",
  RunCompleted: "completed",
});

const SIDE_EFFECT_EVENT_KEYS: Readonly<Partial<Record<OrchestrationEventKind, string>>> = Object.freeze({
  ImplementationDispatched: "implementation",
  VerificationDispatched: "verification",
  BranchPushDispatched: "branch_push",
  PrCreateDispatched: "pr_create",
  CiWaitStarted: "ci_wait",
  MergeDispatched: "merge",
  CleanupDispatched: "cleanup",
});

function stoppedSnapshot(
  snapshot: OrchestrationSnapshotV1,
  event: OrchestrationEventV1,
  reason: StopReason,
): OrchestrationSnapshotV1 {
  const { snapshotDigest: _ignored, ...base } = snapshot;
  return withSnapshotDigest({
    ...base,
    phase: "stopped",
    stopReason: reason,
    lastSequence: event.sequence,
    lastEventDigest: event.eventDigest,
  });
}

export function reduceOrchestration(
  snapshotInput: OrchestrationSnapshotV1,
  eventInput: OrchestrationEventV1,
): OrchestrationSnapshotV1 {
  const snapshot = OrchestrationSnapshotV1Schema.parse(snapshotInput);
  const event = OrchestrationEventV1Schema.parse(eventInput);
  if (!verifySnapshotDigest(snapshot)) {
    return stoppedSnapshot(snapshot, event, "corruption_detected");
  }
  if (event.runId !== snapshot.runId || event.sequence !== snapshot.lastSequence + 1 || event.previousEventDigest !== snapshot.lastEventDigest) {
    return stoppedSnapshot(snapshot, event, "corruption_detected");
  }
  if (event.payloadDigest !== domainSeparatedDigest("agent-builder/orchestration/event-payload/v1", event.payload)) {
    return stoppedSnapshot(snapshot, event, "corruption_detected");
  }
  const { eventDigest: _ignoredEventDigest, ...eventBase } = event;
  if (event.eventDigest !== domainSeparatedDigest("agent-builder/orchestration/event/v1", eventBase)) {
    return stoppedSnapshot(snapshot, event, "corruption_detected");
  }
  const eventTime = Date.parse(event.observedAt);
  if (eventTime < Date.parse(snapshot.intent.issuedAt)) {
    return stoppedSnapshot(snapshot, event, "intent_unverifiable");
  }
  if (eventTime > Date.parse(snapshot.intent.expiresAt)) {
    return stoppedSnapshot(snapshot, event, "intent_expired");
  }
  const allowedFrom = TRANSITIONS[event.kind] ?? [];
  if (!allowedFrom.includes(snapshot.phase)) {
    return stoppedSnapshot(snapshot, event, "unknown_state_transition");
  }
  if (event.kind === "StoppedForCause") {
    const parsedReason = StopReasonSchema.safeParse(event.payload["reason"]);
    return stoppedSnapshot(snapshot, event, parsedReason.success ? parsedReason.data : "unknown_event");
  }

  if (event.kind === "RepositoryInspected") {
    const inspection = RepositoryInspectionResultV1Schema.safeParse(event.payload);
    if (!inspection.success) return stoppedSnapshot(snapshot, event, "adapter_error");
    if (inspection.data.originMainSha !== snapshot.intent.baseRevision) {
      return stoppedSnapshot(snapshot, event, "intent_base_mismatch");
    }
  }
  if (event.kind === "VerificationPassed" && !VerificationResultV1Schema.safeParse(event.payload).success) {
    if (event.payload["touchesGovernance"] === true) return stoppedSnapshot(snapshot, event, "governance_touch");
    if (event.payload["deploymentChanged"] === true) return stoppedSnapshot(snapshot, event, "deploy_on_main_detected");
    if (event.payload["capabilityExpanded"] === true || event.payload["diffWithinContract"] === false) {
      return stoppedSnapshot(snapshot, event, "contract_scope_expansion");
    }
    return stoppedSnapshot(snapshot, event, "readback_inconclusive");
  }
  if (event.kind === "MergeGateEvaluated") {
    if (!snapshot.intent.allowPullRequestMerge) {
      return stoppedSnapshot(snapshot, event, "merge_authority_missing");
    }
    if (!MergeGateEvidenceV1Schema.safeParse(event.payload).success) {
      if (event.payload["deploysOnMain"] === true) return stoppedSnapshot(snapshot, event, "deploy_on_main_detected");
      if (event.payload["githubWorkflowChanged"] === true) return stoppedSnapshot(snapshot, event, "governance_touch");
      if (event.payload["diffWithinContract"] === false) return stoppedSnapshot(snapshot, event, "contract_scope_expansion");
      if (event.payload["defaultBranchProtected"] === false) return stoppedSnapshot(snapshot, event, "merge_authority_missing");
      return stoppedSnapshot(snapshot, event, "readback_inconclusive");
    }
  }
  if (event.kind === "BranchPushDispatched" && !snapshot.intent.allowFeatureBranchPush) {
    return stoppedSnapshot(snapshot, event, "intent_scope_violation");
  }
  if (event.kind === "PrCreateDispatched" && !snapshot.intent.allowPullRequestCreate) {
    return stoppedSnapshot(snapshot, event, "intent_scope_violation");
  }

  const { snapshotDigest: _ignoredSnapshotDigest, ...base } = snapshot;
  let next: Omit<OrchestrationSnapshotV1, "snapshotDigest"> = {
    ...base,
    phase: event.kind === "ContractProposalRecorded" ? snapshot.phase : NEXT_PHASE[event.kind],
    lastSequence: event.sequence,
    lastEventDigest: event.eventDigest,
  };

  if (event.kind === "StepSelected") {
    if (snapshot.stepsConsumed >= snapshot.intent.maxSteps) {
      return stoppedSnapshot(snapshot, event, "intent_budget_exhausted");
    }
    const stepId = IdentifierSchema.safeParse(event.payload["stepId"]);
    const route = ModelRoutingDecisionV1Schema.safeParse(event.payload["routingDecision"]);
    if (!stepId.success || !route.success || !validateModelRoutingDecision(route.data, snapshot.intent.allowDegradedModelFallback)) {
      return stoppedSnapshot(snapshot, event, "model_route_policy_violation");
    }
    next = { ...next, currentStepId: stepId.data, routingDecision: route.data, stepsConsumed: snapshot.stepsConsumed + 1 };
  }
  if (event.kind === "NegotiationOpened") {
    const stepId = snapshot.currentStepId;
    if (stepId === null) return stoppedSnapshot(snapshot, event, "contract_malformed");
    const consumed = snapshot.claudeRoundsConsumed[stepId] ?? 0;
    if (consumed >= snapshot.intent.maxClaudeRoundsPerStep) {
      return stoppedSnapshot(snapshot, event, "claude_round_exhausted");
    }
    next = { ...next, claudeRoundsConsumed: { ...snapshot.claudeRoundsConsumed, [stepId]: consumed + 1 } };
  }
  if (event.kind === "ContractLocked") {
    const contract = LockedStepContractV1Schema.safeParse(event.payload["contract"]);
    const digestMatches = contract.success &&
      contract.data.contractDigest === computeLockedContractDigest(
        (({ contractDigest: _ignored, ...value }) => value)(contract.data),
      );
    if (
      !contract.success ||
      !digestMatches ||
      contract.data.stepId !== snapshot.currentStepId ||
      contract.data.baseRevision !== snapshot.intent.baseRevision ||
      contract.data.maxClaudeRounds !== snapshot.intent.maxClaudeRoundsPerStep ||
      snapshot.routingDecision === null ||
      domainSeparatedDigest("agent-builder/orchestration/model-route/v1", contract.data.routingDecision) !==
        domainSeparatedDigest("agent-builder/orchestration/model-route/v1", snapshot.routingDecision)
    ) {
      return stoppedSnapshot(snapshot, event, "contract_digest_mismatch");
    }
    next = { ...next, contract: contract.data };
  }
  const sideEffectKey = SIDE_EFFECT_EVENT_KEYS[event.kind];
  if (sideEffectKey !== undefined) {
    const key = `${snapshot.currentStepId ?? "none"}:${sideEffectKey}`;
    const consumed = snapshot.sideEffectAttemptsConsumed[key] ?? 0;
    if (consumed >= snapshot.intent.maxAttemptsPerSideEffect) {
      return stoppedSnapshot(snapshot, event, "attempt_exhausted");
    }
    next = { ...next, sideEffectAttemptsConsumed: { ...snapshot.sideEffectAttemptsConsumed, [key]: consumed + 1 } };
  }
  return withSnapshotDigest(next);
}

export function createSideEffectIdempotencyKey(
  snapshot: OrchestrationSnapshotV1,
  phase: string,
  attemptNumber: number,
): string {
  return domainSeparatedDigest("agent-builder/orchestration/side-effect/v1", {
    runId: snapshot.runId,
    stepId: snapshot.currentStepId,
    phase,
    attemptNumber,
    contractDigest: snapshot.contract?.contractDigest ?? null,
  });
}

export function stopReasonPrecedence(reason: StopReason): number {
  return STOP_REASONS.indexOf(reason);
}

export type { LockedStepContractV1, ModelRoutingDecisionV1, RunIntentV1 };

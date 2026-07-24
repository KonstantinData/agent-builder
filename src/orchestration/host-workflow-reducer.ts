import { z } from "zod";
import { domainSeparatedDigest } from "./canonical-json.js";
import { DigestSchema, GitShaSchema, IdentifierSchema, Rfc3339InstantSchema } from "./contracts.js";
import {
  CanonicalFeatureRefSchema,
  LockedStepContractV2Schema,
  OrphanRefReportV1Schema,
  RunIntentV2Schema,
  RunStartEvidenceV2Schema,
  verifyLockedStepContractV2Digest,
  verifyOrphanRefReportV1,
  verifyRunIntentV2Digest,
  type LockedStepContractV2,
  type RunIntentV2,
  type RunStartEvidenceV2,
} from "./host-workflow-contracts.js";

export const HOST_WORKFLOW_PHASES = [
  "contract_locked",
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
  "step_complete",
  "stopped",
] as const;
export const HostWorkflowPhaseSchema = z.enum(HOST_WORKFLOW_PHASES);
export type HostWorkflowPhase = z.infer<typeof HostWorkflowPhaseSchema>;

export const HOST_WORKFLOW_STOP_REASONS = [
  "corruption_detected",
  "adapter_unavailable",
  "intent_scope_violation",
  "evidence_untrustworthy",
  "readback_inconclusive",
  "binding_mismatch",
  "dirty_worktree",
  "base_not_ancestor",
  "diff_outside_contract",
  "forbidden_surface",
  "head_unavailable",
  "typecheck_failed",
  "tests_failed",
  "capability_expansion",
  "deployment_change",
  "head_mismatch",
  "default_branch_target",
  "protected_branch_target",
  "refspec_invalid",
  "remote_untrusted",
  "remote_ref_conflict",
  "provider_error",
  "multiple_matching_prs",
  "closed_without_merge",
  "already_merged_unexpectedly",
  "base_mismatch",
  "machine_block_mismatch",
  "ci_failed",
  "ci_response_untrustworthy",
  "ci_poll_budget_exhausted",
  "merge_authority_missing",
  "base_branch_advanced",
  "checks_unsatisfied",
  "review_unsatisfied",
  "workflow_state_unknown",
  "pr_not_mergeable",
  "merge_rejected",
  "merge_readback_unreachable",
  "contract_scope_expansion",
  "attempt_exhausted",
  "intent_expired",
] as const;
export const HostWorkflowStopReasonSchema = z.enum(HOST_WORKFLOW_STOP_REASONS);
export type HostWorkflowStopReason = z.infer<typeof HostWorkflowStopReasonSchema>;

export const HostWorkflowEffectKindSchema = z.enum(["verification", "feature_ref", "pull_request", "merge"]);
export type HostWorkflowEffectKind = z.infer<typeof HostWorkflowEffectKindSchema>;

export const PendingHostWorkflowEffectV1Schema = z.object({
  kind: HostWorkflowEffectKindSchema,
  idempotencyKey: DigestSchema,
  bindingDigest: DigestSchema,
  binding: z.record(z.string(), z.unknown()),
}).strict();
export type PendingHostWorkflowEffectV1 = z.infer<typeof PendingHostWorkflowEffectV1Schema>;

export const HostWorkflowSnapshotV1Schema = z.object({
  schemaVersion: z.literal("host-workflow-snapshot/1"),
  runId: IdentifierSchema,
  stepId: IdentifierSchema,
  phase: HostWorkflowPhaseSchema,
  intent: RunIntentV2Schema,
  startEvidence: RunStartEvidenceV2Schema,
  contract: LockedStepContractV2Schema,
  headSha: GitShaSchema,
  featureRef: CanonicalFeatureRefSchema.nullable(),
  pullRequestNumber: z.number().int().positive().nullable(),
  machineBlockDigest: DigestSchema.nullable(),
  ciReadsConsumed: z.number().int().nonnegative(),
  sideEffectAttemptsConsumed: z.record(HostWorkflowEffectKindSchema, z.number().int().nonnegative()),
  pendingEffect: PendingHostWorkflowEffectV1Schema.nullable(),
  evidenceDigests: z.array(DigestSchema),
  orphanReports: z.array(OrphanRefReportV1Schema),
  lastSequence: z.number().int().nonnegative(),
  lastEventDigest: DigestSchema.nullable(),
  stopReason: HostWorkflowStopReasonSchema.nullable(),
  snapshotDigest: DigestSchema,
}).strict();
export type HostWorkflowSnapshotV1 = z.infer<typeof HostWorkflowSnapshotV1Schema>;

export const HostWorkflowEventKindSchema = z.enum([
  "ExternalImplementationVerified",
  "VerificationPending",
  "VerificationSettled",
  "FeatureRefPending",
  "FeatureRefSettled",
  "PullRequestPending",
  "PullRequestSettled",
  "CiReadCharged",
  "CiObservedPending",
  "CiObservedPassed",
  "MergeGatePassed",
  "MergePending",
  "MergeSettled",
  "CleanupVerified",
  "OrphanRefReported",
  "StoppedForCause",
]);
export type HostWorkflowEventKind = z.infer<typeof HostWorkflowEventKindSchema>;

export const HostWorkflowEventV1Schema = z.object({
  schemaVersion: z.literal("host-workflow-event/1"),
  eventId: IdentifierSchema,
  runId: IdentifierSchema,
  sequence: z.number().int().positive(),
  observedAt: Rfc3339InstantSchema,
  kind: HostWorkflowEventKindSchema,
  payload: z.record(z.string(), z.unknown()),
  payloadDigest: DigestSchema,
  previousEventDigest: DigestSchema.nullable(),
  eventDigest: DigestSchema,
}).strict();
export type HostWorkflowEventV1 = z.infer<typeof HostWorkflowEventV1Schema>;

function withSnapshotDigest(snapshot: Omit<HostWorkflowSnapshotV1, "snapshotDigest">): HostWorkflowSnapshotV1 {
  return HostWorkflowSnapshotV1Schema.parse({
    ...snapshot,
    snapshotDigest: domainSeparatedDigest("agent-builder/orchestration/host-workflow-snapshot/v1", snapshot),
  });
}

export function verifyHostWorkflowSnapshotDigest(snapshot: HostWorkflowSnapshotV1): boolean {
  const parsed = HostWorkflowSnapshotV1Schema.safeParse(snapshot);
  if (!parsed.success) return false;
  const { snapshotDigest, ...payload } = parsed.data;
  return snapshotDigest === domainSeparatedDigest("agent-builder/orchestration/host-workflow-snapshot/v1", payload);
}

export function createHostWorkflowSnapshot(input: {
  readonly runId: string;
  readonly intent: RunIntentV2;
  readonly startEvidence: RunStartEvidenceV2;
  readonly contract: LockedStepContractV2;
  readonly headSha: string;
}): HostWorkflowSnapshotV1 {
  const intent = RunIntentV2Schema.parse(input.intent);
  const contract = LockedStepContractV2Schema.parse(input.contract);
  const startEvidence = RunStartEvidenceV2Schema.parse(input.startEvidence);
  if (!verifyRunIntentV2Digest(intent) || !verifyLockedStepContractV2Digest(contract)) {
    throw new TypeError("host workflow requires canonical v2 intent and contract digests");
  }
  if (
    contract.runId !== input.runId ||
    contract.baseRevision !== intent.baseRevision ||
    contract.maxClaudeRounds !== intent.maxClaudeRoundsPerStep ||
    contract.workflowSafetyManifestDigest !== startEvidence.workflowSafetyManifestDigest
  ) {
    throw new TypeError("host workflow handoff bindings do not match");
  }
  return withSnapshotDigest({
    schemaVersion: "host-workflow-snapshot/1",
    runId: input.runId,
    stepId: contract.stepId,
    phase: "contract_locked",
    intent,
    startEvidence,
    contract,
    headSha: GitShaSchema.parse(input.headSha),
    featureRef: null,
    pullRequestNumber: null,
    machineBlockDigest: null,
    ciReadsConsumed: 0,
    sideEffectAttemptsConsumed: { verification: 0, feature_ref: 0, pull_request: 0, merge: 0 },
    pendingEffect: null,
    evidenceDigests: [],
    orphanReports: [],
    lastSequence: 0,
    lastEventDigest: null,
    stopReason: null,
  });
}

export function createHostWorkflowEvent(input: {
  readonly eventId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly observedAt: string;
  readonly kind: HostWorkflowEventKind;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly previousEventDigest: string | null;
}): HostWorkflowEventV1 {
  const payload = input.payload ?? {};
  const payloadDigest = domainSeparatedDigest("agent-builder/orchestration/host-workflow-event-payload/v1", payload);
  const base = {
    schemaVersion: "host-workflow-event/1" as const,
    eventId: input.eventId,
    runId: input.runId,
    sequence: input.sequence,
    observedAt: input.observedAt,
    kind: input.kind,
    payload,
    payloadDigest,
    previousEventDigest: input.previousEventDigest,
  };
  return HostWorkflowEventV1Schema.parse({
    ...base,
    eventDigest: domainSeparatedDigest("agent-builder/orchestration/host-workflow-event/v1", base),
  });
}

const PendingPayloadSchema = z.object({
  pendingEffect: PendingHostWorkflowEffectV1Schema,
}).strict();
const EvidencePayloadSchema = z.object({ evidenceDigest: DigestSchema }).strict();
const FeatureRefSettledPayloadSchema = EvidencePayloadSchema.extend({
  ref: CanonicalFeatureRefSchema,
  headSha: GitShaSchema,
}).strict();
const PullRequestSettledPayloadSchema = EvidencePayloadSchema.extend({
  pullRequestNumber: z.number().int().positive(),
  machineBlockDigest: DigestSchema,
}).strict();
const OrphanPayloadSchema = z.object({ report: OrphanRefReportV1Schema }).strict();
const StopPayloadSchema = z.object({ reason: HostWorkflowStopReasonSchema }).strict();

const ALLOWED_FROM: Readonly<Record<HostWorkflowEventKind, readonly HostWorkflowPhase[]>> = {
  ExternalImplementationVerified: ["contract_locked"],
  VerificationPending: ["implementation_complete"],
  VerificationSettled: ["verification_pending"],
  FeatureRefPending: ["verified"],
  FeatureRefSettled: ["branch_push_pending"],
  PullRequestPending: ["branch_pushed"],
  PullRequestSettled: ["pr_create_pending"],
  CiReadCharged: ["pr_open", "ci_pending"],
  CiObservedPending: ["ci_pending"],
  CiObservedPassed: ["ci_pending"],
  MergeGatePassed: ["ci_passed"],
  MergePending: ["merge_ready"],
  MergeSettled: ["merge_pending"],
  CleanupVerified: ["merged"],
  OrphanRefReported: HOST_WORKFLOW_PHASES.filter((phase) => phase !== "step_complete"),
  StoppedForCause: HOST_WORKFLOW_PHASES.filter((phase) => phase !== "step_complete" && phase !== "stopped"),
};

function corrupted(snapshot: HostWorkflowSnapshotV1): HostWorkflowSnapshotV1 {
  const { snapshotDigest: _ignored, ...base } = snapshot;
  return withSnapshotDigest({ ...base, phase: "stopped", stopReason: "corruption_detected" });
}

function stoppedWithEvent(
  snapshot: HostWorkflowSnapshotV1,
  event: HostWorkflowEventV1,
  reason: HostWorkflowStopReason,
): HostWorkflowSnapshotV1 {
  const { snapshotDigest: _ignored, ...base } = snapshot;
  return withSnapshotDigest({
    ...base,
    phase: "stopped",
    stopReason: reason,
    pendingEffect: null,
    lastSequence: event.sequence,
    lastEventDigest: event.eventDigest,
  });
}

export function reduceHostWorkflow(
  snapshotInput: HostWorkflowSnapshotV1,
  eventInput: HostWorkflowEventV1,
): HostWorkflowSnapshotV1 {
  const snapshot = HostWorkflowSnapshotV1Schema.parse(snapshotInput);
  const event = HostWorkflowEventV1Schema.parse(eventInput);
  if (!verifyHostWorkflowSnapshotDigest(snapshot)) return corrupted(snapshot);
  const { eventDigest: _eventDigest, ...eventBase } = event;
  if (
    event.runId !== snapshot.runId ||
    event.sequence !== snapshot.lastSequence + 1 ||
    event.previousEventDigest !== snapshot.lastEventDigest ||
    event.payloadDigest !== domainSeparatedDigest("agent-builder/orchestration/host-workflow-event-payload/v1", event.payload) ||
    event.eventDigest !== domainSeparatedDigest("agent-builder/orchestration/host-workflow-event/v1", eventBase) ||
    !ALLOWED_FROM[event.kind].includes(snapshot.phase)
  ) return corrupted(snapshot);
  const eventTime = Date.parse(event.observedAt);
  if (eventTime < Date.parse(snapshot.intent.issuedAt)) return corrupted(snapshot);
  if (
    eventTime > Date.parse(snapshot.intent.expiresAt) &&
    !(event.kind === "StoppedForCause" && event.payload["reason"] === "intent_expired")
  ) return stoppedWithEvent(snapshot, event, "intent_expired");

  const { snapshotDigest: _snapshotDigest, ...current } = snapshot;
  let next: Omit<HostWorkflowSnapshotV1, "snapshotDigest"> = {
    ...current,
    lastSequence: event.sequence,
    lastEventDigest: event.eventDigest,
  };
  const addEvidence = (digest: string): void => {
    next = { ...next, evidenceDigests: [...next.evidenceDigests, digest] };
  };

  if (event.kind === "StoppedForCause") {
    const parsed = StopPayloadSchema.safeParse(event.payload);
    return parsed.success
      ? withSnapshotDigest({ ...next, phase: "stopped", stopReason: parsed.data.reason, pendingEffect: null })
      : corrupted(snapshot);
  }
  if (event.kind === "OrphanRefReported") {
    const parsed = OrphanPayloadSchema.safeParse(event.payload);
    if (!parsed.success || !verifyOrphanRefReportV1(parsed.data.report)) return corrupted(snapshot);
    return withSnapshotDigest({ ...next, orphanReports: [...next.orphanReports, parsed.data.report] });
  }
  if (
    event.kind === "VerificationPending" ||
    event.kind === "FeatureRefPending" ||
    event.kind === "PullRequestPending" ||
    event.kind === "MergePending"
  ) {
    const parsed = PendingPayloadSchema.safeParse(event.payload);
    if (!parsed.success || snapshot.pendingEffect !== null) return corrupted(snapshot);
    const consumed = snapshot.sideEffectAttemptsConsumed[parsed.data.pendingEffect.kind] ?? 0;
    if (consumed >= snapshot.intent.maxAttemptsPerSideEffect) {
      return withSnapshotDigest({ ...next, phase: "stopped", stopReason: "attempt_exhausted" });
    }
    const phaseByKind: Record<HostWorkflowEffectKind, HostWorkflowPhase> = {
      verification: "verification_pending",
      feature_ref: "branch_push_pending",
      pull_request: "pr_create_pending",
      merge: "merge_pending",
    };
    return withSnapshotDigest({
      ...next,
      phase: phaseByKind[parsed.data.pendingEffect.kind],
      pendingEffect: parsed.data.pendingEffect,
      sideEffectAttemptsConsumed: {
        ...snapshot.sideEffectAttemptsConsumed,
        [parsed.data.pendingEffect.kind]: consumed + 1,
      },
    });
  }
  if (event.kind === "ExternalImplementationVerified") {
    const parsed = EvidencePayloadSchema.safeParse(event.payload);
    if (!parsed.success) return corrupted(snapshot);
    addEvidence(parsed.data.evidenceDigest);
    return withSnapshotDigest({ ...next, phase: "implementation_complete" });
  }
  if (event.kind === "VerificationSettled") {
    const parsed = EvidencePayloadSchema.safeParse(event.payload);
    if (!parsed.success || snapshot.pendingEffect?.kind !== "verification") return corrupted(snapshot);
    addEvidence(parsed.data.evidenceDigest);
    return withSnapshotDigest({ ...next, phase: "verified", pendingEffect: null });
  }
  if (event.kind === "FeatureRefSettled") {
    const parsed = FeatureRefSettledPayloadSchema.safeParse(event.payload);
    if (!parsed.success || snapshot.pendingEffect?.kind !== "feature_ref") return corrupted(snapshot);
    addEvidence(parsed.data.evidenceDigest);
    return withSnapshotDigest({ ...next, phase: "branch_pushed", pendingEffect: null, featureRef: parsed.data.ref, headSha: parsed.data.headSha });
  }
  if (event.kind === "PullRequestSettled") {
    const parsed = PullRequestSettledPayloadSchema.safeParse(event.payload);
    if (!parsed.success || snapshot.pendingEffect?.kind !== "pull_request") return corrupted(snapshot);
    addEvidence(parsed.data.evidenceDigest);
    return withSnapshotDigest({ ...next, phase: "pr_open", pendingEffect: null, pullRequestNumber: parsed.data.pullRequestNumber, machineBlockDigest: parsed.data.machineBlockDigest });
  }
  if (event.kind === "CiReadCharged") {
    if (Object.keys(event.payload).length !== 0) return corrupted(snapshot);
    if (snapshot.ciReadsConsumed >= snapshot.intent.maxCiReadsPerStep) {
      return withSnapshotDigest({ ...next, phase: "stopped", stopReason: "ci_poll_budget_exhausted" });
    }
    return withSnapshotDigest({ ...next, phase: "ci_pending", ciReadsConsumed: snapshot.ciReadsConsumed + 1 });
  }
  if (event.kind === "CiObservedPending") {
    const parsed = EvidencePayloadSchema.safeParse(event.payload);
    if (!parsed.success) return corrupted(snapshot);
    addEvidence(parsed.data.evidenceDigest);
    return withSnapshotDigest({ ...next, phase: "ci_pending" });
  }
  if (event.kind === "CiObservedPassed") {
    const parsed = EvidencePayloadSchema.safeParse(event.payload);
    if (!parsed.success) return corrupted(snapshot);
    addEvidence(parsed.data.evidenceDigest);
    return withSnapshotDigest({ ...next, phase: "ci_passed" });
  }
  if (event.kind === "MergeGatePassed") {
    const parsed = EvidencePayloadSchema.safeParse(event.payload);
    if (!parsed.success) return corrupted(snapshot);
    addEvidence(parsed.data.evidenceDigest);
    return withSnapshotDigest({ ...next, phase: "merge_ready" });
  }
  if (event.kind === "MergeSettled") {
    const parsed = EvidencePayloadSchema.safeParse(event.payload);
    if (!parsed.success || snapshot.pendingEffect?.kind !== "merge") return corrupted(snapshot);
    addEvidence(parsed.data.evidenceDigest);
    return withSnapshotDigest({ ...next, phase: "merged", pendingEffect: null });
  }
  if (event.kind === "CleanupVerified") {
    const parsed = EvidencePayloadSchema.safeParse(event.payload);
    if (!parsed.success || snapshot.pendingEffect !== null) return corrupted(snapshot);
    addEvidence(parsed.data.evidenceDigest);
    return withSnapshotDigest({ ...next, phase: "step_complete" });
  }
  return corrupted(snapshot);
}

export function createHostWorkflowIdempotencyKey(
  snapshot: HostWorkflowSnapshotV1,
  kind: HostWorkflowEffectKind,
): string {
  return domainSeparatedDigest("agent-builder/orchestration/host-workflow-effect/v1", {
    runId: snapshot.runId,
    stepId: snapshot.stepId,
    contractDigest: snapshot.contract.contractDigest,
    kind,
    attempt: (snapshot.sideEffectAttemptsConsumed[kind] ?? 0) + 1,
  });
}

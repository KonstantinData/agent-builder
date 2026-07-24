import { z } from "zod";
import { domainSeparatedDigest } from "./canonical-json.js";
import {
  EnvironmentAttestationV1Schema,
  RoadmapV1Schema,
  RoadmapBaseReconciliationBindingV1Schema,
  Rfc3339InstantSchema,
  RunIntentV1Schema,
  type RoadmapItemV1,
  type RoadmapV1,
  type RunIntentV1,
  verifyRunIntentDigest,
} from "./contracts.js";
import {
  verifyEvidenceEnvelope,
  type EvidenceEnvelope,
  type RunAdapters,
} from "./adapters.js";
import type { ModelRoutingInput } from "./model-routing.js";
import { selectModelRoute } from "./model-routing.js";
import {
  FileOrchestrationStore,
  OrchestrationPersistenceError,
} from "./persistence.js";
import {
  createOrchestrationEvent,
  createVerifiedRunSnapshot,
  RepositoryInspectionResultV1Schema,
  type OrchestrationEventKind,
  type OrchestrationSnapshotV1,
  type StopReason,
} from "./reducer.js";
import {
  GLOBAL_FORBIDDEN_SURFACES,
  selectNextRoadmapItem,
  type CommitReachabilityProof,
} from "./roadmap.js";

export interface ExplicitInstantSource {
  next(): string;
}

export type ControllerBoundaryReason =
  | "awaiting_external_implementation"
  | "adapter_unavailable"
  | "readback_inconclusive"
  | "pending_reconciliation_required"
  | "model_route_unavailable"
  | "negotiation_round_budget_exhausted"
  | "transition_budget_exhausted"
  | "step_budget_exhausted"
  | "intent_expired"
  | "store_lock_unavailable";

export type ControllerResult =
  | {
      readonly kind: "start_rejected";
      readonly reason: "intent_untrusted" | "attestation_missing" | "attestation_invalid";
      readonly detail: string;
      readonly persisted: false;
    }
  | {
      readonly kind: "stopped";
      readonly runId: string;
      readonly snapshotDigest: string;
      readonly terminalPhase: "stopped";
      readonly cause: "attestation_failed_post_snapshot" | "readback_conflict" | "adapter_rejected" | "invariant_violation";
      readonly detail: string;
      readonly transitionsApplied: number;
    }
  | {
      readonly kind: "boundary";
      readonly runId: string;
      readonly snapshotDigest: string;
      readonly phase: OrchestrationSnapshotV1["phase"];
      readonly reason: ControllerBoundaryReason;
      readonly detail: string;
      readonly transitionsApplied: number;
    };

export interface AttendedControllerRequest {
  readonly runId: string;
  readonly intent: RunIntentV1;
  readonly roadmap: RoadmapV1;
  readonly store: FileOrchestrationStore;
  readonly adapters: RunAdapters;
  readonly instantSource: ExplicitInstantSource;
  readonly maxTransitions: number;
  readonly modelRoutingInputForStep: (item: RoadmapItemV1) => ModelRoutingInput;
  readonly successCriteriaForStep: (item: RoadmapItemV1) => readonly string[];
}

type StartRejectedResult = Extract<ControllerResult, { readonly kind: "start_rejected" }>;
type FreshStartVerificationResult = StartRejectedResult | {
  readonly kind: "verified";
  readonly startEvidence: NonNullable<OrchestrationSnapshotV1["startEvidence"]>;
};

const MaxTransitionsSchema = z.number().int().min(1).max(32);
const ProposalPayloadSchema = z
  .object({
    stepId: z.string().min(1),
    allowedPaths: z.array(z.string().min(1)).min(1),
    successCriteria: z.array(z.string().min(1)).min(1),
    rationale: z.string().min(1).max(4_000),
  })
  .strict();
const StepSelectionPayloadSchema = z
  .object({
    stepId: z.string().min(1),
    successCriteria: z.array(z.string().min(1)).min(1),
    baseReconciliation: RoadmapBaseReconciliationBindingV1Schema.nullable().optional(),
    expectedBaseMergeSha: z.string().regex(/^[0-9a-f]{40}$/).optional(),
  })
  .passthrough();

function repositoryInspectionValueDigest(value: {
  readonly originMainSha: string;
  readonly attendedLocal: boolean;
  readonly completedStepReachability: Readonly<Record<string, boolean>>;
  readonly baseReconciliationProof?: unknown;
  readonly deploysOnMain: boolean;
  readonly defaultBranchProtected: boolean;
}): string {
  return domainSeparatedDigest("agent-builder/orchestration/repository-inspection-value/v1", {
    originMainSha: value.originMainSha,
    attendedLocal: value.attendedLocal,
    completedStepReachability: value.completedStepReachability,
    baseReconciliationProof: value.baseReconciliationProof ?? null,
    deploysOnMain: value.deploysOnMain,
    defaultBranchProtected: value.defaultBranchProtected,
  });
}

export class ControllerInvariantError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ControllerInvariantError";
  }
}

function startRejected(
  reason: "intent_untrusted" | "attestation_missing" | "attestation_invalid",
  detail: string,
): StartRejectedResult {
  return { kind: "start_rejected", reason, detail, persisted: false };
}

function verifyObservedAt(evidence: EvidenceEnvelope<unknown>): boolean {
  return Rfc3339InstantSchema.safeParse(evidence.observedAt).success;
}

function stopCause(reason: StopReason | null): "adapter_rejected" | "invariant_violation" {
  return reason === "corruption_detected" || reason === "unknown_event" || reason === "unknown_state_transition"
    ? "invariant_violation"
    : "adapter_rejected";
}

export class AttendedOrchestrationController {
  public async runUntilBoundary(request: AttendedControllerRequest): Promise<ControllerResult> {
    const maxTransitions = MaxTransitionsSchema.parse(request.maxTransitions);
    const roadmap = RoadmapV1Schema.parse(request.roadmap);
    const parsedIntent = RunIntentV1Schema.safeParse(request.intent);
    if (!parsedIntent.success || !verifyRunIntentDigest(request.intent)) {
      return startRejected("intent_untrusted", "run intent schema or canonical digest is invalid");
    }

    if (!(await request.store.hasSnapshot())) {
      const start = await this.verifyFreshStart(request);
      if (start.kind !== "verified") return start;
      await request.store.initialize(createVerifiedRunSnapshot(request.runId, request.intent, start.startEvidence));
    }

    const release = await request.store.acquireControllerLock();
    if (release === null) {
      const snapshot = await request.store.load();
      return {
        kind: "boundary",
        runId: snapshot.runId,
        snapshotDigest: snapshot.snapshotDigest,
        phase: snapshot.phase,
        reason: "store_lock_unavailable",
        detail: "an attended controller invocation already owns the per-run lock",
        transitionsApplied: 0,
      };
    }

    try {
      return await this.runLocked(request, roadmap, maxTransitions);
    } finally {
      await release();
    }
  }

  private async verifyFreshStart(
    request: AttendedControllerRequest,
  ): Promise<FreshStartVerificationResult> {
    const environmentAttestor = request.adapters.environmentAttestor;
    if (environmentAttestor === undefined) {
      return startRejected("attestation_missing", "environment attestor is not configured");
    }
    const intentVerifier = request.adapters.runIntentVerifier;
    if (intentVerifier === undefined) {
      return startRejected("intent_untrusted", "run intent verifier is not configured");
    }

    let environment;
    let intentVerification;
    try {
      [environment, intentVerification] = await Promise.all([
        environmentAttestor.attest(),
        intentVerifier.verify(request.intent),
      ]);
    } catch {
      return startRejected("attestation_invalid", "start verifier raised an error");
    }
    const environmentValue = EnvironmentAttestationV1Schema.safeParse(environment.value);
    if (
      !environmentValue.success ||
      !verifyEvidenceEnvelope(environment) ||
      !verifyObservedAt(environment) ||
      environmentValue.data.observedAt !== environment.observedAt
    ) {
      return startRejected("attestation_invalid", "environment evidence is malformed or untrustworthy");
    }
    if (
      !verifyEvidenceEnvelope(intentVerification) ||
      !verifyObservedAt(intentVerification) ||
      intentVerification.value.valid !== true
    ) {
      return startRejected("intent_untrusted", "intent verifier did not return valid digest-bound evidence");
    }
    const observed = Date.parse(environment.observedAt);
    if (observed < Date.parse(request.intent.issuedAt) || observed > Date.parse(request.intent.expiresAt)) {
      return startRejected("attestation_invalid", "environment attestation is outside the run-intent validity window");
    }
    return {
      kind: "verified",
      startEvidence: {
        schemaVersion: "run-start-evidence/1",
        environmentAttestationDigest: environment.evidenceDigest,
        environmentObservedAt: environment.observedAt,
        intentVerificationDigest: intentVerification.evidenceDigest,
        intentVerificationObservedAt: intentVerification.observedAt,
        roadmapDigest: domainSeparatedDigest("agent-builder/orchestration/roadmap/v1", request.roadmap),
      },
    };
  }

  private async runLocked(
    request: AttendedControllerRequest,
    roadmap: RoadmapV1,
    maxTransitions: number,
  ): Promise<ControllerResult> {
    let transitionsApplied = 0;
    let snapshot: OrchestrationSnapshotV1;
    try {
      snapshot = await request.store.load();
    } catch (error) {
      if (error instanceof OrchestrationPersistenceError || error instanceof z.ZodError) {
        throw new ControllerInvariantError("persisted snapshot/event chain is invalid");
      }
      throw error;
    }
    if (snapshot.startEvidence === null) {
      throw new ControllerInvariantError("persisted run is missing immutable start evidence");
    }
    if (snapshot.runId !== request.runId || snapshot.intent.intentDigest !== request.intent.intentDigest) {
      throw new ControllerInvariantError("resume request does not match the persisted run identity or intent");
    }
    if (snapshot.startEvidence.roadmapDigest !== domainSeparatedDigest("agent-builder/orchestration/roadmap/v1", roadmap)) {
      throw new ControllerInvariantError("resume roadmap differs from the roadmap bound at run start");
    }

    let events = [...await request.store.loadEvents()];
    const pendingPhases = events.filter((event) => event.kind.endsWith("Dispatched"))
      .filter((event) => event.sequence > this.lastSettlementSequence(events, event.kind));
    if (pendingPhases.length > 1) throw new ControllerInvariantError("more than one pending side effect exists");
    if (pendingPhases.length === 1 || snapshot.phase.endsWith("_pending")) {
      return this.boundary(snapshot, "readback_inconclusive", "pending side effect requires a configured read-back adapter", transitionsApplied);
    }

    const apply = async (
      kind: OrchestrationEventKind,
      payload: Readonly<Record<string, unknown>> = {},
    ): Promise<ControllerResult | null> => {
      if (transitionsApplied >= maxTransitions) {
        return this.boundary(snapshot, "transition_budget_exhausted", "controller transition budget is exhausted", transitionsApplied);
      }
      const observedAt = Rfc3339InstantSchema.parse(request.instantSource.next());
      const event = createOrchestrationEvent({
        eventId: `event:${snapshot.runId}:${snapshot.lastSequence + 1}:${kind}`,
        runId: snapshot.runId,
        sequence: snapshot.lastSequence + 1,
        observedAt,
        kind,
        payload,
        previousEventDigest: snapshot.lastEventDigest,
      });
      snapshot = await request.store.append(snapshot, event);
      events = [...await request.store.loadEvents()];
      transitionsApplied += 1;
      if (snapshot.phase === "stopped") {
        return {
          kind: "stopped",
          runId: snapshot.runId,
          snapshotDigest: snapshot.snapshotDigest,
          terminalPhase: "stopped",
          cause: stopCause(snapshot.stopReason),
          detail: snapshot.stopReason ?? "unknown stop reason",
          transitionsApplied,
        };
      }
      return null;
    };

    let authorizedNegotiationSequence: number | null = null;

    for (;;) {
      if (snapshot.phase === "completed") {
        return this.boundary(snapshot, "step_budget_exhausted", "run completed within its bounded intent", transitionsApplied);
      }
      if (snapshot.phase === "stopped") {
        return {
          kind: "stopped",
          runId: snapshot.runId,
          snapshotDigest: snapshot.snapshotDigest,
          terminalPhase: "stopped",
          cause: stopCause(snapshot.stopReason),
          detail: snapshot.stopReason ?? "unknown stop reason",
          transitionsApplied,
        };
      }
      if (snapshot.phase === "contract_locked") {
        const driver = request.adapters.implementationDriver;
        if (driver === undefined || driver.kind === "external_attended") {
          return this.boundary(snapshot, "awaiting_external_implementation", "repository code cannot invoke the external attended implementation driver", transitionsApplied);
        }
        return this.boundary(snapshot, "adapter_unavailable", "local-process implementation dispatch is not shipped in controller v0.1", transitionsApplied);
      }
      if (snapshot.phase === "intent_verified" || snapshot.phase === "step_complete") {
        const inspector = request.adapters.repositoryInspector;
        if (inspector === undefined) return this.boundary(snapshot, "adapter_unavailable", "repositoryInspector", transitionsApplied);
        const inspection = await inspector.inspect({ repository: request.intent.repository, expectedBaseRevision: request.intent.baseRevision, roadmap });
        if (!verifyEvidenceEnvelope(inspection)) {
          const result = await apply("StoppedForCause", { reason: "adapter_error" });
          if (result !== null) return result;
          continue;
        }
        const result = await apply("RepositoryInspected", {
          evidenceDigest: inspection.evidenceDigest,
          inspectionValueDigest: repositoryInspectionValueDigest(inspection.value),
          originMainSha: inspection.value.originMainSha,
          attendedLocal: inspection.value.attendedLocal,
          deploysOnMain: inspection.value.deploysOnMain,
          defaultBranchProtected: inspection.value.defaultBranchProtected,
          roadmapHistoryVerified: Object.values(inspection.value.completedStepReachability).every(Boolean),
          completedStepReachability: inspection.value.completedStepReachability,
          baseReconciliationProof: inspection.value.baseReconciliationProof ?? null,
        });
        if (result !== null) return result;
        continue;
      }
      if (snapshot.phase === "repository_inspected") {
        const inspector = request.adapters.repositoryInspector;
        if (inspector === undefined) return this.boundary(snapshot, "adapter_unavailable", "repositoryInspector", transitionsApplied);
        const persistedInspectionEvent = [...events].reverse().find((event) => event.kind === "RepositoryInspected");
        const inspection = RepositoryInspectionResultV1Schema.safeParse(persistedInspectionEvent?.payload);
        if (!inspection.success) throw new ControllerInvariantError("persisted repository inspection is missing or malformed");
        if (
          inspection.data.inspectionValueDigest === undefined ||
          inspection.data.completedStepReachability === undefined
        ) {
          const result = await apply("StoppedForCause", { reason: "roadmap_base_reconciliation_unverified" });
          if (result !== null) return result;
          continue;
        }
        let confirmation;
        try {
          confirmation = await inspector.inspect({
            repository: request.intent.repository,
            expectedBaseRevision: request.intent.baseRevision,
            roadmap,
          });
        } catch {
          const result = await apply("StoppedForCause", { reason: "adapter_error" });
          if (result !== null) return result;
          continue;
        }
        if (
          !verifyEvidenceEnvelope(confirmation) ||
          repositoryInspectionValueDigest(confirmation.value) !== inspection.data.inspectionValueDigest
        ) {
          const result = await apply("StoppedForCause", { reason: "roadmap_base_reconciliation_unverified" });
          if (result !== null) return result;
          continue;
        }
        const proofs: CommitReachabilityProof[] = Object.entries(inspection.data.completedStepReachability)
          .map(([commitSha, reachableFromOriginMain]) => ({ commitSha, reachableFromOriginMain }));
        const selection = selectNextRoadmapItem(
          roadmap,
          request.intent,
          inspection.data.originMainSha,
          proofs,
          inspection.data.baseReconciliationProof ?? null,
        );
        if (selection.kind === "completed") {
          const result = await apply("RunCompleted");
          if (result !== null) return result;
          continue;
        }
        if (selection.kind === "stopped") {
          const result = await apply("StoppedForCause", { reason: selection.reason });
          if (result !== null) return result;
          continue;
        }
        const route = selectModelRoute(request.modelRoutingInputForStep(selection.item));
        if (route.kind === "stopped") {
          const result = await apply("StoppedForCause", { reason: route.reason });
          if (result !== null) return result;
          continue;
        }
        const successCriteria = [...request.successCriteriaForStep(selection.item)];
        if (successCriteria.length === 0) throw new ControllerInvariantError("selected step has no success criteria");
        const result = await apply("StepSelected", {
          stepId: selection.item.stepId,
          routingDecision: route.decision,
          successCriteria,
          baseReconciliation: selection.baseReconciliation,
          expectedBaseMergeSha: selection.item.expectedBaseMergeSha,
        });
        if (result !== null) return result;
        continue;
      }
      if (snapshot.phase === "step_selected") {
        if (request.adapters.contractNegotiator === undefined) {
          return this.boundary(snapshot, "adapter_unavailable", "contractNegotiator", transitionsApplied);
        }
        const item = roadmap.items.find((candidate) => candidate.stepId === snapshot.currentStepId);
        if (item === undefined) throw new ControllerInvariantError("persisted selected step is absent from the bound roadmap");
        this.validatedStepSelection(events, item, snapshot);
        if (transitionsApplied + 2 > maxTransitions) {
          return this.boundary(snapshot, "transition_budget_exhausted", "a Claude dispatch and its response require two remaining transitions", transitionsApplied);
        }
        const result = await apply("NegotiationOpened");
        if (result !== null) return result;
        authorizedNegotiationSequence = snapshot.lastSequence;
        continue;
      }
      if (snapshot.phase === "contract_negotiating") {
        const negotiator = request.adapters.contractNegotiator;
        if (negotiator === undefined) return this.boundary(snapshot, "adapter_unavailable", "contractNegotiator", transitionsApplied);
        const lastEvent = events.at(-1);
        if (lastEvent?.kind === "ContractProposalRecorded") {
          const consumedRounds = snapshot.claudeRoundsConsumed[snapshot.currentStepId ?? ""] ?? 0;
          if (consumedRounds >= snapshot.intent.maxClaudeRoundsPerStep) {
            return this.boundary(snapshot, "negotiation_round_budget_exhausted", "Claude round budget is exhausted without a locked contract", transitionsApplied);
          }
          if (transitionsApplied + 2 > maxTransitions) {
            return this.boundary(snapshot, "transition_budget_exhausted", "a Claude dispatch and its response require two remaining transitions", transitionsApplied);
          }
          const opened = await apply("NegotiationOpened");
          if (opened !== null) return opened;
          authorizedNegotiationSequence = snapshot.lastSequence;
          continue;
        }
        if (lastEvent?.kind !== "NegotiationOpened") {
          throw new ControllerInvariantError("contract negotiation phase has no dispatch event");
        }
        if (authorizedNegotiationSequence !== lastEvent.sequence) {
          return this.boundary(snapshot, "pending_reconciliation_required", "a persisted Claude dispatch has no trustworthy response event", transitionsApplied);
        }
        const item = roadmap.items.find((candidate) => candidate.stepId === snapshot.currentStepId);
        if (item === undefined || snapshot.routingDecision === null) throw new ControllerInvariantError("selected roadmap item or route is missing");
        const proposal = this.lastProposal(events, item.stepId);
        const selection = this.validatedStepSelection(events, item, snapshot);
        const allowedPaths = proposal?.allowedPaths ?? item.allowedPaths;
        const successCriteria = proposal?.successCriteria ?? selection.successCriteria;
        let negotiation;
        try {
          negotiation = await negotiator.negotiate({
            schemaVersion: "claude-negotiation-request/1",
            runId: snapshot.runId,
            stepId: item.stepId,
            baseRevision: request.intent.baseRevision,
            changeClass: item.changeClass,
            allowedPaths,
            forbiddenSurfaces: [...GLOBAL_FORBIDDEN_SURFACES, ...item.forbiddenSurfaces],
            successCriteria,
            roundNumber: snapshot.claudeRoundsConsumed[item.stepId] ?? 1,
            priorRoundsSummary: proposal?.rationale ?? "",
            routingDecision: snapshot.routingDecision,
            baseReconciliation: selection.baseReconciliation ?? null,
          });
        } catch {
          const result = await apply("StoppedForCause", { reason: "adapter_error" });
          if (result !== null) return result;
          continue;
        }
        authorizedNegotiationSequence = null;
        if (negotiation.kind === "stopped") {
          const result = await apply("StoppedForCause", { reason: negotiation.reason });
          if (result !== null) return result;
          continue;
        }
        if (negotiation.response.kind === "conflict") {
          const result = await apply("StoppedForCause", { reason: "contract_conflict" });
          if (result !== null) return result;
          continue;
        }
        if (negotiation.response.kind === "proposal") {
          const result = await apply("ContractProposalRecorded", {
            stepId: item.stepId,
            allowedPaths: negotiation.response.allowedPaths,
            successCriteria: negotiation.response.successCriteria,
            rationale: negotiation.response.rationale,
          });
          if (result !== null) return result;
          continue;
        }
        const result = await apply("ContractLocked", { contract: negotiation.response.contract });
        if (result !== null) return result;
        continue;
      }
      return this.boundary(snapshot, "adapter_unavailable", `phase ${snapshot.phase} is not driven by controller v0.1`, transitionsApplied);
    }
  }

  private boundary(
    snapshot: OrchestrationSnapshotV1,
    reason: ControllerBoundaryReason,
    detail: string,
    transitionsApplied: number,
  ): ControllerResult {
    return {
      kind: "boundary",
      runId: snapshot.runId,
      snapshotDigest: snapshot.snapshotDigest,
      phase: snapshot.phase,
      reason,
      detail,
      transitionsApplied,
    };
  }

  private lastSettlementSequence(events: readonly { readonly kind: string; readonly sequence: number }[], dispatchedKind: string): number {
    const prefix = dispatchedKind.replace("Dispatched", "");
    return events
      .filter((event) => event.kind.startsWith(prefix) && (event.kind.endsWith("Readback") || event.kind.endsWith("Claimed") || event.kind.endsWith("Passed")))
      .reduce((maximum, event) => Math.max(maximum, event.sequence), 0);
  }

  private lastProposal(events: readonly { readonly kind: string; readonly payload: Readonly<Record<string, unknown>> }[], stepId: string): z.infer<typeof ProposalPayloadSchema> | null {
    const candidates = events.filter((event) => event.kind === "ContractProposalRecorded").reverse();
    for (const candidate of candidates) {
      const parsed = ProposalPayloadSchema.safeParse(candidate.payload);
      if (parsed.success && parsed.data.stepId === stepId) return parsed.data;
    }
    return null;
  }

  private stepSelection(events: readonly { readonly kind: string; readonly payload: Readonly<Record<string, unknown>> }[], stepId: string): z.infer<typeof StepSelectionPayloadSchema> | null {
    const candidates = events.filter((event) => event.kind === "StepSelected").reverse();
    for (const candidate of candidates) {
      const parsed = StepSelectionPayloadSchema.safeParse(candidate.payload);
      if (parsed.success && parsed.data.stepId === stepId) return parsed.data;
    }
    return null;
  }

  private validatedStepSelection(
    events: readonly { readonly kind: string; readonly payload: Readonly<Record<string, unknown>> }[],
    item: RoadmapItemV1,
    snapshot: OrchestrationSnapshotV1,
  ): z.infer<typeof StepSelectionPayloadSchema> {
    const selection = this.stepSelection(events, item.stepId);
    if (selection === null) throw new ControllerInvariantError("persisted step selection is missing success criteria");
    if (selection.expectedBaseMergeSha === undefined) {
      if (
        snapshot.inspectionBaseReconciliation !== undefined ||
        item.expectedBaseMergeSha !== snapshot.intent.baseRevision
      ) {
        throw new ControllerInvariantError("legacy step selection is not an exact-base selection");
      }
    } else if (selection.expectedBaseMergeSha !== item.expectedBaseMergeSha) {
      throw new ControllerInvariantError("persisted step base differs from the bound roadmap item");
    }
    if (domainSeparatedDigest(
      "agent-builder/orchestration/roadmap-base-reconciliation-binding/v1",
      selection.baseReconciliation ?? null,
    ) !== domainSeparatedDigest(
      "agent-builder/orchestration/roadmap-base-reconciliation-binding/v1",
      snapshot.baseReconciliation ?? null,
    )) {
      throw new ControllerInvariantError("persisted step reconciliation differs from the selected snapshot");
    }
    return selection;
  }
}

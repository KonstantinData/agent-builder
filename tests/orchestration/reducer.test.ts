import { describe, expect, it } from "vitest";
import {
  createOrchestrationEvent,
  createVerifiedRunSnapshot,
  reduceOrchestration,
  stopReasonPrecedence,
  type OrchestrationEventKind,
  type OrchestrationSnapshotV1,
} from "../../src/orchestration/reducer.js";
import { BASE_SHA, terraRoute, testContract, testIntent } from "./support.js";

const defaultPayloads: Partial<Record<OrchestrationEventKind, Record<string, unknown>>> = {
  RepositoryInspected: {
    evidenceDigest: "a".repeat(64),
    originMainSha: BASE_SHA,
    attendedLocal: true,
    deploysOnMain: false,
    defaultBranchProtected: true,
    roadmapHistoryVerified: true,
  },
  VerificationPassed: {
    typecheckPassed: true,
    testsPassed: true,
    diffWithinContract: true,
    touchesGovernance: false,
    capabilityExpanded: false,
    deploymentChanged: false,
  },
  MergeGateEvaluated: {
    exactHeadVerified: true,
    baseCompatible: true,
    requiredChecksPassed: true,
    reviewPolicySatisfied: true,
    deploysOnMain: false,
    githubWorkflowChanged: false,
    diffWithinContract: true,
    defaultBranchProtected: true,
    pullRequestOpenAndMergeable: true,
  },
};

function advance(
  snapshot: OrchestrationSnapshotV1,
  kind: OrchestrationEventKind,
  payload: Record<string, unknown> = {},
): OrchestrationSnapshotV1 {
  return reduceOrchestration(snapshot, createOrchestrationEvent({
    eventId: `event-${snapshot.lastSequence + 1}`,
    runId: snapshot.runId,
    sequence: snapshot.lastSequence + 1,
    observedAt: `2026-07-24T10:${String(snapshot.lastSequence).padStart(2, "0")}:00Z`,
    kind,
    payload: { ...defaultPayloads[kind], ...payload },
    previousEventDigest: snapshot.lastEventDigest,
  }));
}

describe("bounded orchestration reducer", () => {
  it("pins the full legal phase chain and charges attempts before side effects", () => {
    let state = createVerifiedRunSnapshot("run-001", testIntent());
    state = advance(state, "RepositoryInspected");
    state = advance(state, "StepSelected", { stepId: "step-16", routingDecision: terraRoute });
    state = advance(state, "NegotiationOpened");
    state = advance(state, "ContractProposalRecorded");
    state = advance(state, "NegotiationOpened");
    state = advance(state, "ContractLocked", { contract: testContract() });
    state = advance(state, "ImplementationDispatched");
    expect(state.sideEffectAttemptsConsumed["step-16:implementation"]).toBe(1);
    state = advance(state, "ImplementationClaimed");
    state = advance(state, "VerificationDispatched");
    state = advance(state, "VerificationPassed");
    state = advance(state, "BranchPushDispatched");
    state = advance(state, "BranchPushReadback");
    state = advance(state, "PrCreateDispatched");
    state = advance(state, "PrOpenReadback");
    state = advance(state, "CiWaitStarted");
    state = advance(state, "CiReadback");
    state = advance(state, "MergeGateEvaluated");
    state = advance(state, "MergeDispatched");
    state = advance(state, "MergeReadback");
    state = advance(state, "CleanupDispatched");
    state = advance(state, "StepCompleted");
    state = advance(state, "RunCompleted");
    expect(state).toMatchObject({ phase: "completed", stepsConsumed: 1, stopReason: null });
  });

  it("fails closed on illegal transitions, tampering, and exhausted step budget", () => {
    const initial = createVerifiedRunSnapshot("run-001", testIntent({ maxSteps: 1 }));
    expect(advance(initial, "MergeDispatched")).toMatchObject({ phase: "stopped", stopReason: "unknown_state_transition" });

    const inspected = advance(initial, "RepositoryInspected");
    let selected = advance(inspected, "StepSelected", { stepId: "step-16", routingDecision: terraRoute });
    selected = advance(selected, "NegotiationOpened");
    selected = advance(selected, "ContractLocked", { contract: testContract() });
    selected = advance(selected, "ImplementationDispatched");
    selected = advance(selected, "ImplementationClaimed");
    selected = advance(selected, "VerificationDispatched");
    selected = advance(selected, "VerificationPassed");
    selected = advance(selected, "BranchPushDispatched");
    selected = advance(selected, "BranchPushReadback");
    selected = advance(selected, "PrCreateDispatched");
    selected = advance(selected, "PrOpenReadback");
    selected = advance(selected, "CiWaitStarted");
    selected = advance(selected, "CiReadback");
    selected = advance(selected, "MergeGateEvaluated");
    selected = advance(selected, "MergeDispatched");
    selected = advance(selected, "MergeReadback");
    selected = advance(selected, "CleanupDispatched");
    selected = advance(selected, "StepCompleted");
    const looped = advance(selected, "RepositoryInspected");
    expect(advance(looped, "StepSelected", { stepId: "step-17", routingDecision: terraRoute })).toMatchObject({
      phase: "stopped",
      stopReason: "intent_budget_exhausted",
    });

    const badSequence = createOrchestrationEvent({
      eventId: "event-bad",
      runId: initial.runId,
      sequence: 2,
      observedAt: "2026-07-24T10:00:00Z",
      kind: "RepositoryInspected",
      previousEventDigest: null,
    });
    expect(reduceOrchestration(initial, badSequence)).toMatchObject({ phase: "stopped", stopReason: "corruption_detected" });

    const validEvent = createOrchestrationEvent({
      eventId: "event-valid",
      runId: initial.runId,
      sequence: 1,
      observedAt: "2026-07-24T10:00:00Z",
      kind: "RepositoryInspected",
      previousEventDigest: null,
    });
    expect(reduceOrchestration({ ...initial, stepsConsumed: 1 }, validEvent)).toMatchObject({
      phase: "stopped",
      stopReason: "corruption_detected",
    });
  });

  it("stops when an explicit event instant is outside the verified intent window", () => {
    const initial = createVerifiedRunSnapshot("run-001", testIntent());
    const expired = createOrchestrationEvent({
      eventId: "event-expired",
      runId: initial.runId,
      sequence: 1,
      observedAt: "2026-07-25T00:00:00Z",
      kind: "RepositoryInspected",
      previousEventDigest: null,
    });
    expect(reduceOrchestration(initial, expired)).toMatchObject({ phase: "stopped", stopReason: "intent_expired" });
  });

  it("uses stable explicit stop precedence", () => {
    expect(stopReasonPrecedence("corruption_detected")).toBeLessThan(stopReasonPrecedence("intent_missing"));
    expect(stopReasonPrecedence("model_route_unavailable")).toBeLessThan(stopReasonPrecedence("contract_conflict"));
  });

  it("requires strict verification and merge-gate evidence", () => {
    let state = createVerifiedRunSnapshot("run-001", testIntent());
    state = advance(state, "RepositoryInspected");
    state = advance(state, "StepSelected", { stepId: "step-16", routingDecision: terraRoute });
    state = advance(state, "NegotiationOpened");
    state = advance(state, "ContractLocked", { contract: testContract() });
    state = advance(state, "ImplementationDispatched");
    state = advance(state, "ImplementationClaimed");
    state = advance(state, "VerificationDispatched");
    expect(advance(state, "VerificationPassed", { testsPassed: false })).toMatchObject({
      phase: "stopped",
      stopReason: "readback_inconclusive",
    });
  });
});

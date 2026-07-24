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
import {
  createRoadmapBaseReconciliationProofV1,
  reconciliationBinding,
  RECONCILIATION_WORKFLOW_SAFETY_MANIFEST_DIGEST,
  ROADMAP_RECONCILIATION_POLICY_DIGEST,
} from "../../src/orchestration/roadmap-reconciliation.js";
import { bootstrapReconciliationProof, PR18_MERGE_SHA } from "./reconciliation-support.js";

const defaultPayloads: Partial<Record<OrchestrationEventKind, Record<string, unknown>>> = {
  RepositoryInspected: {
    evidenceDigest: "a".repeat(64),
    inspectionValueDigest: "b".repeat(64),
    originMainSha: BASE_SHA,
    attendedLocal: true,
    deploysOnMain: false,
    defaultBranchProtected: true,
    roadmapHistoryVerified: true,
    completedStepReachability: { [BASE_SHA]: true },
    baseReconciliationProof: null,
  },
  StepSelected: {
    baseReconciliation: null,
    expectedBaseMergeSha: BASE_SHA,
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

  it("binds StepSelected directly to the persisted reconciliation proof identity", () => {
    const proof = bootstrapReconciliationProof();
    const initial = createVerifiedRunSnapshot(
      "run-reconciled-001",
      testIntent({ baseRevision: PR18_MERGE_SHA }),
    );
    const inspected = reduceOrchestration(initial, createOrchestrationEvent({
      eventId: "event-reconciled-inspection",
      runId: initial.runId,
      sequence: 1,
      observedAt: "2026-07-24T10:00:00Z",
      kind: "RepositoryInspected",
      payload: {
        evidenceDigest: "a".repeat(64),
        inspectionValueDigest: "b".repeat(64),
        originMainSha: PR18_MERGE_SHA,
        attendedLocal: true,
        deploysOnMain: false,
        defaultBranchProtected: false,
        roadmapHistoryVerified: true,
        completedStepReachability: { [BASE_SHA]: true },
        baseReconciliationProof: proof,
      },
      previousEventDigest: null,
    }));
    expect(inspected.inspectionBaseReconciliation).toEqual(reconciliationBinding(proof));

    const select = (baseReconciliation: unknown) => reduceOrchestration(inspected, createOrchestrationEvent({
      eventId: `event-reconciled-selection-${String(baseReconciliation === null)}`,
      runId: inspected.runId,
      sequence: 2,
      observedAt: "2026-07-24T10:01:00Z",
      kind: "StepSelected",
      payload: {
        stepId: "step-16",
        routingDecision: terraRoute,
        baseReconciliation,
        expectedBaseMergeSha: BASE_SHA,
      },
      previousEventDigest: inspected.lastEventDigest,
    }));
    expect(select(null)).toMatchObject({
      phase: "stopped",
      stopReason: "roadmap_base_reconciliation_unverified",
    });
    expect(reduceOrchestration(inspected, createOrchestrationEvent({
      eventId: "event-reconciled-selection-missing-new-fields",
      runId: inspected.runId,
      sequence: 2,
      observedAt: "2026-07-24T10:01:00Z",
      kind: "StepSelected",
      payload: { stepId: "step-16", routingDecision: terraRoute },
      previousEventDigest: inspected.lastEventDigest,
    }))).toMatchObject({
      phase: "stopped",
      stopReason: "roadmap_base_reconciliation_unverified",
    });
    expect(select({ ...reconciliationBinding(proof), proofDigest: "0".repeat(64) })).toMatchObject({
      phase: "stopped",
      stopReason: "roadmap_base_reconciliation_unverified",
    });
    expect(select(reconciliationBinding(proof))).toMatchObject({
      phase: "step_selected",
      baseReconciliation: { proofDigest: proof.proofDigest },
    });

    const superfluousProof = createRoadmapBaseReconciliationProofV1({
      schemaVersion: "roadmap-base-reconciliation-proof/1",
      policyDigest: ROADMAP_RECONCILIATION_POLICY_DIGEST,
      domainBaseSha: "0".repeat(40),
      observedOriginMainSha: BASE_SHA,
      commits: [{
        schemaVersion: "transparent-meta-commit-proof/1",
        source: "github_pull_request",
        mergeMethod: "squash",
        parentSha: "0".repeat(40),
        mergeCommitSha: BASE_SHA,
        mergeCommitReachableFromOriginMain: true,
        mergeCommitTreeMatchesPullRequestHead: true,
        pullRequestNumber: 99,
        pullRequestHeadSha: "1".repeat(40),
        pullRequestState: "merged",
        mergedAt: "2026-07-24T09:00:00Z",
        requiredCheck: { name: "verify", headSha: "1".repeat(40), conclusion: "success" },
        workflowSafetyManifestDigest: RECONCILIATION_WORKFLOW_SAFETY_MANIFEST_DIGEST,
        changedPaths: ["README.md"],
        capabilityEffect: "reduce_or_preserve",
        deploymentEffect: "none",
      }],
    });
    const exactInitial = createVerifiedRunSnapshot("run-exact-with-proof", testIntent());
    const exactInspected = reduceOrchestration(exactInitial, createOrchestrationEvent({
      eventId: "event-exact-inspection",
      runId: exactInitial.runId,
      sequence: 1,
      observedAt: "2026-07-24T10:00:00Z",
      kind: "RepositoryInspected",
      payload: {
        evidenceDigest: "a".repeat(64),
        inspectionValueDigest: "b".repeat(64),
        originMainSha: BASE_SHA,
        attendedLocal: true,
        deploysOnMain: false,
        defaultBranchProtected: true,
        roadmapHistoryVerified: true,
        completedStepReachability: { [BASE_SHA]: true },
        baseReconciliationProof: superfluousProof,
      },
      previousEventDigest: null,
    }));
    const exactSelected = reduceOrchestration(exactInspected, createOrchestrationEvent({
      eventId: "event-exact-selection",
      runId: exactInitial.runId,
      sequence: 2,
      observedAt: "2026-07-24T10:01:00Z",
      kind: "StepSelected",
      payload: {
        stepId: "step-16",
        routingDecision: terraRoute,
        baseReconciliation: null,
        expectedBaseMergeSha: BASE_SHA,
      },
      previousEventDigest: exactInspected.lastEventDigest,
    }));
    expect(exactSelected).toMatchObject({ phase: "step_selected" });
    expect(exactSelected.baseReconciliation ?? null).toBeNull();
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

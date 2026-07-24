import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  createEvidenceEnvelope,
  type RunAdapters,
} from "../../src/orchestration/adapters.js";
import {
  AttendedOrchestrationController,
  ControllerInvariantError,
  type ExplicitInstantSource,
} from "../../src/orchestration/controller.js";
import {
  RoadmapV1Schema,
  computeLockedContractDigest,
  type LockedStepContractV1,
  type RoadmapV1,
} from "../../src/orchestration/contracts.js";
import { FileOrchestrationStore } from "../../src/orchestration/persistence.js";
import { createOrchestrationEvent } from "../../src/orchestration/reducer.js";
import { BASE_SHA, testIntent } from "./support.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function loadRoadmap(): Promise<RoadmapV1> {
  return RoadmapV1Schema.parse(JSON.parse(
    await readFile(new URL("../../roadmap/agent-builder-roadmap.v1.json", import.meta.url), "utf8"),
  ));
}

function explicitInstants(): ExplicitInstantSource {
  let minute = 1;
  return {
    next: () => `2026-07-24T10:${String(minute++).padStart(2, "0")}:00Z`,
  };
}

async function newStore(): Promise<FileOrchestrationStore> {
  const directory = await mkdtemp(join(tmpdir(), "agent-builder-controller-"));
  directories.push(directory);
  return new FileOrchestrationStore(directory);
}

async function adapters(
  roadmap: RoadmapV1,
  overrides: Partial<RunAdapters> = {},
): Promise<RunAdapters> {
  const reachability = Object.fromEntries(
    roadmap.items
      .filter((item) => item.mergeCommitSha !== null)
      .map((item) => [item.mergeCommitSha!, true]),
  );
  return {
    environmentAttestor: {
      attest: async () => createEvidenceEnvelope("test-environment", "2026-07-24T10:00:00Z", {
        schemaVersion: "orchestration-environment/1",
        executionMode: "attended_local",
        ci: false,
        nonInteractive: false,
        observedAt: "2026-07-24T10:00:00Z",
      }),
    },
    runIntentVerifier: {
      verify: async () => createEvidenceEnvelope("test-intent-verifier", "2026-07-24T10:00:00Z", { valid: true }),
    },
    repositoryInspector: {
      inspect: async () => createEvidenceEnvelope("test-repository", "2026-07-24T10:00:00Z", {
        originMainSha: BASE_SHA,
        attendedLocal: true,
        completedStepReachability: reachability,
        deploysOnMain: false,
        defaultBranchProtected: true,
      }),
    },
    contractNegotiator: {
      negotiate: async (request) => {
        const payload = {
          schemaVersion: "locked-step-contract/1" as const,
          runId: request.runId,
          stepId: request.stepId,
          baseRevision: request.baseRevision,
          changeClass: request.changeClass,
          capabilityEffect: "reduce_or_preserve" as const,
          deploymentEffect: "none" as const,
          allowedPaths: request.allowedPaths,
          forbiddenSurfaces: request.forbiddenSurfaces,
          successCriteria: request.successCriteria,
          maxClaudeRounds: 4,
          routingDecision: request.routingDecision,
        };
        const contract: LockedStepContractV1 = {
          ...payload,
          contractDigest: computeLockedContractDigest(payload),
        };
        return { kind: "response", response: { kind: "locked", contract } };
      },
    },
    implementationDriver: {
      kind: "external_attended",
      dispatch: async () => {
        throw new Error("external attended driver must never be invoked");
      },
    },
    ...overrides,
  };
}

function request(
  store: FileOrchestrationStore,
  roadmap: RoadmapV1,
  configuredAdapters: RunAdapters,
  maxTransitions = 32,
) {
  return {
    runId: "run-controller-001",
    intent: testIntent(),
    roadmap,
    store,
    adapters: configuredAdapters,
    instantSource: explicitInstants(),
    maxTransitions,
    modelRoutingInputForStep: () => ({
      atTaskBoundary: true,
      securityContract: true,
      majorArchitectureDecision: false,
      claudeContractConflict: false,
      unsuccessfulAttemptsInPhase: 0,
      contextComplexityUnits: 10_000,
      availableModels: ["gpt-5.6-terra", "gpt-5.6-sol"] as const,
      allowDegradedFallback: false,
      attemptLimit: 2,
      observableBudget: { unit: "turns" as const, limit: 4 },
    }),
    successCriteriaForStep: () => ["pnpm typecheck", "pnpm test"],
  };
}

describe("attended orchestration controller", () => {
  it("advances a fresh persisted run through a real contract lock and stops at the external implementation boundary", async () => {
    const roadmap = await loadRoadmap();
    const store = await newStore();
    const controller = new AttendedOrchestrationController();
    const result = await controller.runUntilBoundary(request(store, roadmap, await adapters(roadmap)));

    expect(result).toMatchObject({
      kind: "boundary",
      phase: "contract_locked",
      reason: "awaiting_external_implementation",
      transitionsApplied: 4,
    });
    const snapshot = await store.load();
    expect(snapshot.startEvidence).not.toBeNull();
    expect(snapshot).toMatchObject({ phase: "contract_locked", currentStepId: "step-16" });
    expect((await store.loadEvents())).toHaveLength(4);

    const resumed = await controller.runUntilBoundary(request(store, roadmap, await adapters(roadmap)));
    expect(resumed).toMatchObject({
      kind: "boundary",
      reason: "awaiting_external_implementation",
      transitionsApplied: 0,
      snapshotDigest: snapshot.snapshotDigest,
    });
  });

  it("rejects an unverified fresh start without creating a snapshot", async () => {
    const roadmap = await loadRoadmap();
    const store = await newStore();
    const configured = await adapters(roadmap);
    const { environmentAttestor: _ignoredEnvironmentAttestor, ...withoutEnvironmentAttestor } = configured;
    const result = await new AttendedOrchestrationController().runUntilBoundary(request(
      store,
      roadmap,
      withoutEnvironmentAttestor,
    ));
    expect(result).toMatchObject({ kind: "start_rejected", reason: "attestation_missing", persisted: false });
    expect(await store.hasSnapshot()).toBe(false);
  });

  it("enforces the per-invocation transition budget without extending the run intent", async () => {
    const roadmap = await loadRoadmap();
    const store = await newStore();
    const result = await new AttendedOrchestrationController().runUntilBoundary(
      request(store, roadmap, await adapters(roadmap), 1),
    );
    expect(result).toMatchObject({
      kind: "boundary",
      phase: "repository_inspected",
      reason: "transition_budget_exhausted",
      transitionsApplied: 1,
    });
    expect((await store.load()).intent.maxSteps).toBe(3);
  });

  it("does not write a pending event when the next required adapter is absent", async () => {
    const roadmap = await loadRoadmap();
    const store = await newStore();
    const configured = await adapters(roadmap);
    const { contractNegotiator: _ignoredContractNegotiator, ...withoutContractNegotiator } = configured;
    const result = await new AttendedOrchestrationController().runUntilBoundary(request(store, roadmap, withoutContractNegotiator));
    expect(result).toMatchObject({
      kind: "boundary",
      phase: "step_selected",
      reason: "adapter_unavailable",
      detail: "contractNegotiator",
    });
    expect((await store.loadEvents()).map((event) => event.kind)).toEqual([
      "RepositoryInspected",
      "StepSelected",
    ]);
  });

  it("returns store_lock_unavailable without mutating the locked run", async () => {
    const roadmap = await loadRoadmap();
    const store = await newStore();
    const controller = new AttendedOrchestrationController();
    await controller.runUntilBoundary(request(store, roadmap, await adapters(roadmap), 1));
    const before = await store.load();
    const release = await store.acquireControllerLock();
    expect(release).not.toBeNull();
    try {
      const result = await controller.runUntilBoundary(request(store, roadmap, await adapters(roadmap)));
      expect(result).toMatchObject({
        kind: "boundary",
        reason: "store_lock_unavailable",
        transitionsApplied: 0,
        snapshotDigest: before.snapshotDigest,
      });
    } finally {
      await release?.();
    }
    expect((await store.load()).snapshotDigest).toBe(before.snapshotDigest);
  });

  it("binds the roadmap and success criteria across attended resume", async () => {
    const roadmap = await loadRoadmap();
    const store = await newStore();
    const controller = new AttendedOrchestrationController();
    const configured = await adapters(roadmap);
    const first = await controller.runUntilBoundary(request(store, roadmap, configured, 2));
    expect(first).toMatchObject({ phase: "step_selected", reason: "transition_budget_exhausted" });

    const resumedRequest = {
      ...request(store, roadmap, configured),
      successCriteriaForStep: () => ["CHANGED AFTER RESUME"],
    };
    const resumed = await controller.runUntilBoundary(resumedRequest);
    expect(resumed).toMatchObject({ phase: "contract_locked", reason: "awaiting_external_implementation" });
    expect((await store.load()).contract?.successCriteria).toEqual(["pnpm typecheck", "pnpm test"]);

    const changedRoadmap = {
      ...roadmap,
      items: roadmap.items.map((item) => item.stepId === "step-16" ? { ...item, title: `${item.title} changed` } : item),
    };
    await expect(controller.runUntilBoundary(request(store, changedRoadmap, configured))).rejects.toBeInstanceOf(ControllerInvariantError);
  });

  it("never reissues a persisted Claude dispatch whose response is unknown", async () => {
    const roadmap = await loadRoadmap();
    const store = await newStore();
    const controller = new AttendedOrchestrationController();
    const configured = await adapters(roadmap);
    await controller.runUntilBoundary(request(store, roadmap, configured, 2));
    const selected = await store.load();
    const dispatch = createOrchestrationEvent({
      eventId: `event:${selected.runId}:${selected.lastSequence + 1}:NegotiationOpened`,
      runId: selected.runId,
      sequence: selected.lastSequence + 1,
      observedAt: "2026-07-24T10:30:00Z",
      kind: "NegotiationOpened",
      previousEventDigest: selected.lastEventDigest,
    });
    const dispatched = await store.append(selected, dispatch);

    const result = await controller.runUntilBoundary(request(store, roadmap, configured));
    expect(result).toMatchObject({
      kind: "boundary",
      phase: "contract_negotiating",
      reason: "pending_reconciliation_required",
      transitionsApplied: 0,
      snapshotDigest: dispatched.snapshotDigest,
    });
    expect((await store.loadEvents())).toHaveLength(3);
  });
});

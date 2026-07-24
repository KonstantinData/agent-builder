import { describe, expect, it } from "vitest";
import { domainSeparatedDigest } from "../../src/orchestration/canonical-json.js";
import { HostWorkflowController, type HostWorkflowControllerRequest } from "../../src/orchestration/host-workflow-controller.js";
import {
  computeExternalImplementationVerifierDescriptorDigest,
  createLockedStepContractV2,
  createRunIntentV2,
  createWorkflowEvidenceEnvelopeV1,
  createWorkflowSafetyManifestV1,
  type WorkflowAdapterDescriptorV1,
} from "../../src/orchestration/host-workflow-contracts.js";
import { InMemoryHostWorkflowStore } from "../../src/orchestration/host-workflow-persistence.js";
import { workflowAdapterRegistryDigest, workflowEffectBindingDigest, type HostWorkflowAdapters } from "../../src/orchestration/workflow-adapters.js";
import { terraRoute } from "./support.js";

const baseSha = "c".repeat(40);
const headSha = "d".repeat(40);
const digest = (character: string) => character.repeat(64);
const manifest = createWorkflowSafetyManifestV1({
  schemaVersion: "workflow-safety-manifest/1",
  workflows: [{ path: ".github/workflows/ci.yml", blobSha256: digest("a"), classification: "verification_only", requiredChecks: ["verify"] }],
});
const intent = createRunIntentV2({
  schemaVersion: "run-intent/2",
  intentId: "intent-host-001",
  repository: { host: "github", owner: "KonstantinData", name: "agent-builder" },
  baseRevision: baseSha,
  issuedBy: "user-delegation",
  issuedAt: "2026-07-24T10:00:00Z",
  expiresAt: "2026-07-24T22:00:00Z",
  maxSteps: 1,
  maxClaudeRoundsPerStep: 4,
  maxAttemptsPerSideEffect: 2,
  maxCiReadsPerStep: 3,
  allowedChangeClasses: ["governance_meta"],
  allowFeatureBranchPush: true,
  allowPullRequestCreate: true,
  allowPullRequestMerge: true,
  allowDegradedModelFallback: false,
});
const contract = createLockedStepContractV2({
  schemaVersion: "locked-step-contract/2",
  runId: "run-host-001",
  stepId: "step-18",
  baseRevision: baseSha,
  changeClass: "governance_meta",
  capabilityEffect: "reduce_or_preserve",
  deploymentEffect: "none",
  allowedPaths: ["src/orchestration/host-workflow-controller.ts"],
  forbiddenSurfaces: [".github/"],
  successCriteria: ["pnpm typecheck", "pnpm test"],
  maxClaudeRounds: 4,
  routingDecision: terraRoute,
  requiredChecks: ["verify"],
  workflowSafetyManifestDigest: manifest.manifestDigest,
  controllerAddendum: {
    schemaVersion: "host-workflow-controller/1",
    maxTransitionsPerInvocation: 32,
    lockMode: "exclusive_no_wait_no_eviction",
    automatedThroughPhase: "step_complete",
    externalImplementationMode: "external_attended_readback_only",
    branchDeletionAllowed: false,
  },
});

function descriptor(kind: WorkflowAdapterDescriptorV1["kind"], id: string): WorkflowAdapterDescriptorV1 {
  return {
    schemaVersion: "workflow-adapter-descriptor/1",
    adapterId: id,
    adapterConfigDigest: domainSeparatedDigest("test/adapter-config/v1", { id, kind }),
    kind,
  };
}

function envelope<T>(producer: WorkflowAdapterDescriptorV1, binding: unknown, value: T) {
  return createWorkflowEvidenceEnvelopeV1({
    producerId: producer.adapterId,
    producerConfigDigest: producer.adapterConfigDigest,
    observedAt: "2026-07-24T12:00:00Z",
    bindingDigest: workflowEffectBindingDigest(binding as Readonly<Record<string, unknown>>),
    value,
  });
}

function adapters(options: { protected?: boolean; ci?: "success" | "pending"; verificationThrows?: { value: boolean } } = {}) {
  const counts = { verificationInvoke: 0, featureInvoke: 0, prInvoke: 0, ciRead: 0, mergeInvoke: 0 };
  const descriptors = {
    external: descriptor("external_attended_readback_only", "external"),
    verification: descriptor("verification", "verification"),
    feature: descriptor("feature_ref", "feature"),
    pr: descriptor("pull_request", "pullrequest"),
    ci: descriptor("ci_read_only", "cireader"),
    gate: descriptor("merge_gate_read_only", "mergegate"),
    merge: descriptor("merge", "mergeadapter"),
    cleanup: descriptor("cleanup_read_only", "cleanup"),
  };
  const registry: HostWorkflowAdapters = {
    externalImplementation: {
      descriptor: descriptors.external,
      readback: async (input) => ({ kind: "settled", evidence: envelope(descriptors.external, input, {
        idempotencyKey: input.idempotencyKey, runId: input.runId, stepId: input.stepId,
        contractDigest: input.contractDigest, lockedBaseSha: input.lockedBaseSha, headSha: input.headSha,
        changedPaths: ["src/orchestration/host-workflow-controller.ts"], cleanWorktree: true, baseIsAncestor: true,
      }) }),
    },
    verification: {
      descriptor: descriptors.verification,
      invoke: async () => {
        counts.verificationInvoke += 1;
        if (options.verificationThrows?.value === true) {
          options.verificationThrows.value = false;
          throw new Error("crash after effect");
        }
      },
      readback: async (input) => ({ kind: "settled", evidence: envelope(descriptors.verification, input, {
        idempotencyKey: input.idempotencyKey, runId: input.runId, stepId: input.stepId,
        contractDigest: input.contractDigest, headSha: input.headSha,
        changedPaths: ["src/orchestration/host-workflow-controller.ts"], typecheckPassed: true, testsPassed: true,
        diffWithinContract: true, touchesGovernance: false, capabilityExpanded: false, deploymentChanged: false,
      }) }),
    },
    featureRef: {
      descriptor: descriptors.feature,
      invoke: async () => { counts.featureInvoke += 1; },
      readback: async (input) => ({ kind: "settled", evidence: envelope(descriptors.feature, input, {
        idempotencyKey: input.idempotencyKey, lockedBaseSha: input.lockedBaseSha, headSha: input.headSha,
        remoteName: input.remoteName, ref: input.ref,
      }) }),
    },
    pullRequest: {
      descriptor: descriptors.pr,
      invoke: async () => { counts.prInvoke += 1; },
      readback: async (input) => ({ kind: "settled", evidence: envelope(descriptors.pr, input, {
        idempotencyKey: input.idempotencyKey, number: 18, state: "open", draft: false,
        headRef: input.headRef, headSha: input.headSha, baseRef: input.baseRef, baseSha: input.lockedBaseSha,
        mergeable: "mergeable", machineBlockDigest: input.machineBlockDigest,
      }) }),
    },
    ci: {
      descriptor: descriptors.ci,
      read: async (input) => {
        counts.ciRead += 1;
        const pending = options.ci === "pending";
        return envelope(descriptors.ci, input, {
          pullRequestNumber: input.pullRequestNumber, headSha: input.headSha, requiredChecks: ["verify"] as ["verify"],
          checks: [{ name: "verify" as const, headSha: input.headSha, status: pending ? "in_progress" as const : "completed" as const, conclusion: pending ? null : "success" as const }],
        });
      },
    },
    mergeGate: {
      descriptor: descriptors.gate,
      read: async (input) => envelope(descriptors.gate, input, {
        defaultBranchHeadSha: baseSha, lockedBaseSha: baseSha, defaultBranchProtected: options.protected ?? true,
        requiredChecks: ["verify"] as ["verify"], requiredReviewCount: 0, reviewsSatisfied: true,
        adminBypassAllowed: false, bypassUsed: false, pullRequestNumber: input.pullRequestNumber,
        pullRequestOpen: true, pullRequestMergeable: true, headSha, expectedHeadSha: headSha, baseSha,
        machineBlockMatches: true, requiredChecksPassed: true, workflowManifestSafe: true,
        workflowSafetyEvidenceDigest: digest("f"), diffWithinContract: true, forbiddenSurfaceTouched: false,
        capabilityExpanded: false, deploymentChanged: false,
      }),
    },
    merge: {
      descriptor: descriptors.merge,
      invoke: async () => { counts.mergeInvoke += 1; },
      readback: async (input) => ({ kind: "settled", evidence: envelope(descriptors.merge, input, {
        idempotencyKey: input.idempotencyKey, pullRequestNumber: input.pullRequestNumber,
        expectedHeadSha: input.headSha, lockedBaseSha: input.lockedBaseSha, mergeCommitSha: "e".repeat(40),
        state: "merged", mergeCommitReachableFromOriginMain: true,
      }) }),
    },
    cleanup: {
      descriptor: descriptors.cleanup,
      read: async (input) => envelope(descriptors.cleanup, input, { localWorktreeClean: true, branchDeletionPerformed: false }),
    },
  };
  return { registry, counts, descriptors };
}

function request(registry: HostWorkflowAdapters, store = new InMemoryHostWorkflowStore()): HostWorkflowControllerRequest {
  const external = registry.externalImplementation!;
  return {
    runId: contract.runId,
    intent,
    contract,
    startEvidence: {
      schemaVersion: "run-start-evidence/2",
      environmentAttestationDigest: digest("1"), environmentObservedAt: "2026-07-24T11:00:00Z",
      intentVerificationDigest: digest("2"), intentVerificationObservedAt: "2026-07-24T11:00:00Z",
      roadmapDigest: digest("3"), workflowAdapterRegistryDigest: workflowAdapterRegistryDigest(registry),
      externalImplementationVerifierDescriptorDigest: computeExternalImplementationVerifierDescriptorDigest({
        verifierId: external.descriptor.adapterId, verifierConfigDigest: external.descriptor.adapterConfigDigest,
        kind: "external_attended_readback_only",
      }),
      workflowSafetyManifestDigest: manifest.manifestDigest,
    },
    implementationHeadSha: headSha,
    workflowManifest: manifest,
    adapters: registry,
    store,
    instantSource: { next: () => "2026-07-24T12:00:00Z" },
    pullRequestTitle: "Host Workflow Adapter Contract v0.1",
    pullRequestBody: "Machine-bound Slice 18 delivery",
  };
}

describe("host workflow controller", () => {
  it("persists and completes the safe path through cleanup verification without branch deletion", async () => {
    const fake = adapters();
    const result = await new HostWorkflowController().run(request(fake.registry));
    expect(result.kind).toBe("complete");
    expect(fake.counts).toEqual({ verificationInvoke: 1, featureInvoke: 1, prInvoke: 1, ciRead: 1, mergeInvoke: 1 });
    expect(result.snapshot.phase).toBe("step_complete");
    expect(Object.keys(fake.registry.cleanup!)).not.toContain("delete");
  });

  it("stops before merge invocation when main is unprotected and records an orphan ref", async () => {
    const fake = adapters({ protected: false });
    const result = await new HostWorkflowController().run(request(fake.registry));
    expect(result).toMatchObject({ kind: "stopped", reason: "merge_authority_missing" });
    expect(fake.counts.mergeInvoke).toBe(0);
    expect(result.snapshot.orphanReports).toHaveLength(1);
  });

  it("resumes a persisted pending effect with readback only and never invokes twice", async () => {
    const throws = { value: true };
    const fake = adapters({ verificationThrows: throws });
    const store = new InMemoryHostWorkflowStore();
    const first = await new HostWorkflowController().run(request(fake.registry, store));
    expect(first).toMatchObject({ kind: "boundary", reason: "pending_reconciliation_required" });
    const second = await new HostWorkflowController().run(request(fake.registry, store));
    expect(second.kind).toBe("complete");
    expect(fake.counts.verificationInvoke).toBe(1);
  });

  it("charges before each CI read and stops before a fourth read", async () => {
    const fake = adapters({ ci: "pending" });
    const store = new InMemoryHostWorkflowStore();
    const baseRequest = request(fake.registry, store);
    for (let index = 0; index < 3; index += 1) {
      await expect(new HostWorkflowController().run(baseRequest)).resolves.toMatchObject({ kind: "boundary", reason: "ci_pending" });
    }
    const fourth = await new HostWorkflowController().run(baseRequest);
    expect(fourth).toMatchObject({ kind: "stopped", reason: "ci_poll_budget_exhausted" });
    expect(fake.counts.ciRead).toBe(3);
    expect(fourth.snapshot.ciReadsConsumed).toBe(3);
  });

  it("rejects an incomplete state-changing pair before reading or creating state", async () => {
    const fake = adapters();
    const invalid = { ...fake.registry, verification: { descriptor: fake.registry.verification!.descriptor, invoke: async () => {} } } as unknown as HostWorkflowAdapters;
    let storeRead = false;
    const store = new InMemoryHostWorkflowStore();
    const original = store.hasSnapshot.bind(store);
    store.hasSnapshot = async () => { storeRead = true; return await original(); };
    const validRequest = request(fake.registry, store);
    await expect(new HostWorkflowController().run({ ...validRequest, adapters: invalid })).rejects.toThrow("invoke and readback together");
    expect(storeRead).toBe(false);
  });

  it("persists expiry and never invokes an effect whose pending event crossed the intent deadline", async () => {
    const fake = adapters();
    const instants = [
      "2026-07-24T12:00:00Z",
      "2026-07-24T12:00:00Z",
      "2026-07-24T12:00:00Z",
      "2026-07-24T23:00:00Z",
    ];
    const expiringRequest = request(fake.registry);
    const result = await new HostWorkflowController().run({
      ...expiringRequest,
      instantSource: { next: () => instants.shift() ?? "2026-07-24T23:00:00Z" },
    });
    expect(result).toMatchObject({ kind: "stopped", reason: "intent_expired" });
    expect(fake.counts.verificationInvoke).toBe(0);
  });
});

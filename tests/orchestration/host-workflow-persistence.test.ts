import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLockedStepContractV2, createRunIntentV2, createWorkflowSafetyManifestV1 } from "../../src/orchestration/host-workflow-contracts.js";
import { FileHostWorkflowStore, HostWorkflowPersistenceError } from "../../src/orchestration/host-workflow-persistence.js";
import { createHostWorkflowEvent, createHostWorkflowSnapshot } from "../../src/orchestration/host-workflow-reducer.js";
import { terraRoute } from "./support.js";

const sha = "a".repeat(40);
const digest = "b".repeat(64);

function initial() {
  const manifest = createWorkflowSafetyManifestV1({
    schemaVersion: "workflow-safety-manifest/1",
    workflows: [{ path: ".github/workflows/ci.yml", blobSha256: digest, classification: "verification_only", requiredChecks: ["verify"] }],
  });
  const intent = createRunIntentV2({
    schemaVersion: "run-intent/2", intentId: "intent-file", repository: { host: "github", owner: "owner", name: "repo" },
    baseRevision: sha, issuedBy: "test", issuedAt: "2026-07-24T10:00:00Z", expiresAt: "2026-07-24T22:00:00Z",
    maxSteps: 1, maxClaudeRoundsPerStep: 1, maxAttemptsPerSideEffect: 1, maxCiReadsPerStep: 1,
    allowedChangeClasses: ["governance_meta"], allowFeatureBranchPush: true, allowPullRequestCreate: true,
    allowPullRequestMerge: true, allowDegradedModelFallback: false,
  });
  const contract = createLockedStepContractV2({
    schemaVersion: "locked-step-contract/2", runId: "run-file", stepId: "step-18", baseRevision: sha,
    changeClass: "governance_meta", capabilityEffect: "reduce_or_preserve", deploymentEffect: "none",
    allowedPaths: ["src/orchestration/index.ts"], forbiddenSurfaces: [".github/"], successCriteria: ["test"],
    maxClaudeRounds: 1, routingDecision: terraRoute, requiredChecks: ["verify"], workflowSafetyManifestDigest: manifest.manifestDigest,
    controllerAddendum: { schemaVersion: "host-workflow-controller/1", maxTransitionsPerInvocation: 32,
      lockMode: "exclusive_no_wait_no_eviction", automatedThroughPhase: "step_complete",
      externalImplementationMode: "external_attended_readback_only", branchDeletionAllowed: false },
  });
  return createHostWorkflowSnapshot({
    runId: "run-file", intent, contract, headSha: "c".repeat(40),
    startEvidence: { schemaVersion: "run-start-evidence/2", environmentAttestationDigest: digest,
      environmentObservedAt: "2026-07-24T11:00:00Z", intentVerificationDigest: digest,
      intentVerificationObservedAt: "2026-07-24T11:00:00Z", roadmapDigest: digest,
      workflowAdapterRegistryDigest: digest, externalImplementationVerifierDescriptorDigest: digest,
      workflowSafetyManifestDigest: manifest.manifestDigest },
  });
}

describe("file host workflow persistence", () => {
  it("replays an event-first append into the exact durable snapshot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-builder-host-"));
    const store = new FileHostWorkflowStore(directory);
    const snapshot = initial();
    await store.initialize(snapshot);
    const event = createHostWorkflowEvent({
      eventId: "event-file-1", runId: snapshot.runId, sequence: 1, observedAt: "2026-07-24T12:00:00Z",
      kind: "ExternalImplementationVerified", payload: { evidenceDigest: digest }, previousEventDigest: null,
    });
    const appended = await store.append(snapshot, event);
    await expect(store.load()).resolves.toEqual(appended);
  });

  it("rejects snapshot tampering instead of repairing uncertain history", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-builder-host-"));
    const store = new FileHostWorkflowStore(directory);
    const snapshot = initial();
    await store.initialize(snapshot);
    const path = join(directory, "host-workflow-snapshot.json");
    const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    raw["ciReadsConsumed"] = 1;
    await writeFile(path, JSON.stringify(raw), "utf8");
    await expect(store.load()).rejects.toBeInstanceOf(HostWorkflowPersistenceError);
  });
});

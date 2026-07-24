import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  CanonicalFeatureRefSchema,
  ExternalImplementationSettledV1Schema,
  FeatureRefInvocationV1Schema,
  LockedStepContractV2Schema,
  OrphanRefReportV1Schema,
  ReadbackResultV1Schema,
  RunIntentV2Schema,
  RunStartEvidenceV2Schema,
  SortedUniqueRepoPathsSchema,
  VerificationFailureSchema,
  VerificationSettledV1Schema,
  WorkflowSafetyManifestV1Schema,
  canonicalFeatureRef,
  computeExternalImplementationVerifierDescriptorDigest,
  createLockedStepContractV2,
  createOrphanRefReportV1,
  createRunIntentV2,
  createWorkflowEvidenceEnvelopeV1,
  createWorkflowSafetyManifestV1,
  isCanonicalFeatureRef,
  verifyLockedStepContractV2Digest,
  verifyOrphanRefReportV1,
  verifyRunIntentV2Digest,
  verifyWorkflowEvidenceEnvelopeV1,
  verifyWorkflowSafetyManifest,
} from "../../src/orchestration/host-workflow-contracts.js";
import {
  LockedStepContractV1Schema,
  RunStartEvidenceV1Schema,
} from "../../src/orchestration/contracts.js";
import { domainSeparatedDigest } from "../../src/orchestration/canonical-json.js";
import { terraRoute } from "./support.js";

const BASE_SHA = "ce8c4ba614347f408715cdb3fe0dfc1ce128466a";
const HEAD_SHA = "1234567890abcdef1234567890abcdef12345678";
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const DIGEST_C = "c".repeat(64);
const WORKFLOW_SHA256 = "cfda3f0ec624b10599c5a5002285e11374cf178275cfa9c9fa4f3538e03d3d31";

function intentInput() {
  return {
    schemaVersion: "run-intent/2" as const,
    intentId: "intent-host-001",
    repository: { host: "github" as const, owner: "KonstantinData", name: "agent-builder" },
    baseRevision: BASE_SHA,
    issuedBy: "user-delegation",
    issuedAt: "2026-07-24T10:00:00Z",
    expiresAt: "2026-07-24T22:00:00Z",
    maxSteps: 1,
    maxClaudeRoundsPerStep: 4,
    maxAttemptsPerSideEffect: 2,
    allowedChangeClasses: ["governance_meta" as const],
    allowFeatureBranchPush: true,
    allowPullRequestCreate: true,
    allowPullRequestMerge: true,
    allowDegradedModelFallback: false,
  };
}

function manifest() {
  return createWorkflowSafetyManifestV1({
    schemaVersion: "workflow-safety-manifest/1",
    workflows: [{
      path: ".github/workflows/ci.yml",
      blobSha256: WORKFLOW_SHA256,
      classification: "verification_only",
      requiredChecks: ["verify"],
    }],
  });
}

function lockedContract() {
  return createLockedStepContractV2({
    schemaVersion: "locked-step-contract/2",
    runId: "run-host-001",
    stepId: "meta-host-workflow-001",
    baseRevision: BASE_SHA,
    changeClass: "governance_meta",
    capabilityEffect: "reduce_or_preserve",
    deploymentEffect: "none",
    allowedPaths: ["src/orchestration/host-workflow-contracts.ts"],
    forbiddenSurfaces: [".github/"],
    successCriteria: ["pnpm typecheck", "pnpm test"],
    maxClaudeRounds: 4,
    routingDecision: terraRoute,
    requiredChecks: ["verify"],
    workflowSafetyManifestDigest: manifest().manifestDigest,
    controllerAddendum: {
      schemaVersion: "host-workflow-controller/1",
      maxTransitionsPerInvocation: 32,
      lockMode: "exclusive_no_wait_no_eviction",
      automatedThroughPhase: "step_complete",
      externalImplementationMode: "external_attended_readback_only",
      branchDeletionAllowed: false,
    },
  });
}

describe("host workflow run and lock schemas", () => {
  it("materializes the fixed CI-read default before digesting RunIntentV2", () => {
    const intent = createRunIntentV2(intentInput());
    expect(intent.maxCiReadsPerStep).toBe(3);
    expect(verifyRunIntentV2Digest(intent)).toBe(true);
    expect(verifyRunIntentV2Digest({ ...intent, maxCiReadsPerStep: 2 })).toBe(false);
    expect(RunIntentV2Schema.safeParse({ ...intent, maxCiReadsPerStep: 4 }).success).toBe(false);
  });

  it("requires all immutable host registration digests in start evidence v2", () => {
    const evidence = {
      schemaVersion: "run-start-evidence/2",
      environmentAttestationDigest: DIGEST_A,
      environmentObservedAt: "2026-07-24T10:00:00Z",
      intentVerificationDigest: DIGEST_B,
      intentVerificationObservedAt: "2026-07-24T10:00:01Z",
      roadmapDigest: DIGEST_C,
      workflowAdapterRegistryDigest: DIGEST_A,
      externalImplementationVerifierDescriptorDigest: DIGEST_B,
      workflowSafetyManifestDigest: DIGEST_C,
    };
    expect(RunStartEvidenceV2Schema.parse(evidence)).toEqual(evidence);
    const { externalImplementationVerifierDescriptorDigest: _missing, ...incomplete } = evidence;
    expect(RunStartEvidenceV2Schema.safeParse(incomplete).success).toBe(false);
  });

  it("locks required checks and manifest identity into a digest-bound v2 contract", () => {
    const contract = lockedContract();
    expect(verifyLockedStepContractV2Digest(contract)).toBe(true);
    expect(verifyLockedStepContractV2Digest({ ...contract, requiredChecks: ["verify"], workflowSafetyManifestDigest: DIGEST_A })).toBe(false);
    expect(LockedStepContractV2Schema.safeParse({ ...contract, requiredChecks: [] }).success).toBe(false);
    expect(LockedStepContractV2Schema.safeParse({ ...contract, controllerAddendum: { ...contract.controllerAddendum, branchDeletionAllowed: true } }).success).toBe(false);
  });

  it("does not widen the existing v1 start and locked-contract schemas", () => {
    expect(RunStartEvidenceV1Schema.safeParse({
      schemaVersion: "run-start-evidence/1",
      environmentAttestationDigest: DIGEST_A,
      environmentObservedAt: "2026-07-24T10:00:00Z",
      intentVerificationDigest: DIGEST_B,
      intentVerificationObservedAt: "2026-07-24T10:00:01Z",
      roadmapDigest: DIGEST_C,
      workflowAdapterRegistryDigest: DIGEST_A,
    }).success).toBe(false);
    expect(LockedStepContractV1Schema.safeParse(lockedContract()).success).toBe(false);
  });
});

describe("workflow safety manifest and repository paths", () => {
  it("reproduces both committed artifact digests from the current workflow bytes", () => {
    const workflowBytes = readFileSync(".github/workflows/ci.yml");
    expect(createHash("sha256").update(workflowBytes).digest("hex")).toBe(WORKFLOW_SHA256);

    const manifestArtifact = JSON.parse(
      readFileSync("contracts/workflow-safety-manifest.v1.json", "utf8"),
    ) as z.infer<typeof WorkflowSafetyManifestV1Schema>;
    expect(verifyWorkflowSafetyManifest(manifestArtifact)).toBe(true);

    const adapterArtifact = JSON.parse(
      readFileSync("contracts/host-workflow-adapters-v0.1.json", "utf8"),
    ) as Record<string, unknown>;
    const contractDigest = adapterArtifact["contractDigest"];
    const { contractDigest: _ignored, ...payload } = adapterArtifact;
    expect(domainSeparatedDigest(
      "agent-builder/orchestration/host-workflow-adapters-contract/v1",
      payload,
    )).toBe(contractDigest);
  });

  it("creates and verifies the exact verification-only workflow manifest", () => {
    const value = manifest();
    expect(domainSeparatedDigest("agent-builder/orchestration/workflow-safety-manifest/v1", {
      schemaVersion: "workflow-safety-manifest/1",
      workflows: value.workflows,
    })).toBe(value.manifestDigest);
    expect(value.manifestDigest).toBe("09335ea86b39ee2c6f1b026500ae7e5b4faf6c24f1bbdfc37612d16358abbbe1");
    expect(WorkflowSafetyManifestV1Schema.parse(value).workflows).toEqual([{
      path: ".github/workflows/ci.yml",
      blobSha256: WORKFLOW_SHA256,
      classification: "verification_only",
      requiredChecks: ["verify"],
    }]);
    expect(verifyWorkflowSafetyManifest(value)).toBe(true);
    expect(verifyWorkflowSafetyManifest({ ...value, manifestDigest: DIGEST_A })).toBe(false);
  });

  it("rejects unsorted, duplicate, absolute, traversal, and backslash paths", () => {
    expect(SortedUniqueRepoPathsSchema.safeParse(["b.ts", "a.ts"]).success).toBe(false);
    expect(SortedUniqueRepoPathsSchema.safeParse(["a.ts", "a.ts"]).success).toBe(false);
    expect(SortedUniqueRepoPathsSchema.safeParse(["/a.ts"]).success).toBe(false);
    expect(SortedUniqueRepoPathsSchema.safeParse(["src/../a.ts"]).success).toBe(false);
    expect(SortedUniqueRepoPathsSchema.safeParse(["src\\a.ts"]).success).toBe(false);
    expect(ExternalImplementationSettledV1Schema.safeParse({
      idempotencyKey: DIGEST_A,
      runId: "run-host-001",
      stepId: "step-001",
      contractDigest: DIGEST_B,
      lockedBaseSha: BASE_SHA,
      headSha: HEAD_SHA,
      changedPaths: ["z.ts", "a.ts"],
      cleanWorktree: true,
      baseIsAncestor: true,
    }).success).toBe(false);
  });

  it("derives exactly one canonical orchestration feature ref", () => {
    const ref = canonicalFeatureRef("run-host-001", "step-001");
    expect(ref).toBe("refs/heads/orchestration/run-host-001/step-001");
    expect(CanonicalFeatureRefSchema.parse(ref)).toBe(ref);
    expect(isCanonicalFeatureRef(ref, "run-host-001", "step-001")).toBe(true);
    expect(isCanonicalFeatureRef(`${ref}-other`, "run-host-001", "step-001")).toBe(false);
    expect(() => canonicalFeatureRef("run/escape", "step-001")).toThrow();
    expect(FeatureRefInvocationV1Schema.safeParse({
      idempotencyKey: DIGEST_A,
      runId: "run-host-001",
      stepId: "step-001",
      contractDigest: DIGEST_B,
      lockedBaseSha: BASE_SHA,
      headSha: HEAD_SHA,
      remoteName: "origin",
      ref: "refs/heads/main",
    }).success).toBe(false);
  });
});

describe("workflow evidence and readback contracts", () => {
  it("binds evidence to producer configuration, producer instant, and exact invocation", () => {
    const settled = {
      idempotencyKey: DIGEST_A,
      runId: "run-host-001",
      stepId: "step-001",
      contractDigest: DIGEST_B,
      headSha: HEAD_SHA,
      changedPaths: ["src/runtime/example.ts"],
      typecheckPassed: true as const,
      testsPassed: true as const,
      diffWithinContract: true as const,
      touchesGovernance: false as const,
      capabilityExpanded: false as const,
      deploymentChanged: false as const,
    };
    const evidence = createWorkflowEvidenceEnvelopeV1({
      producerId: "test-verifier",
      producerConfigDigest: DIGEST_A,
      observedAt: "2026-07-24T10:10:00Z",
      bindingDigest: DIGEST_B,
      value: settled,
    });
    expect(verifyWorkflowEvidenceEnvelopeV1(evidence, VerificationSettledV1Schema, DIGEST_B)).toBe(true);
    expect(verifyWorkflowEvidenceEnvelopeV1({ ...evidence, observedAt: "2026-07-24T10:11:00Z" }, VerificationSettledV1Schema, DIGEST_B)).toBe(false);
    expect(verifyWorkflowEvidenceEnvelopeV1(evidence, VerificationSettledV1Schema, DIGEST_C)).toBe(false);
  });

  it("requires failed readback evidence to carry the same deterministic failure", () => {
    const failureEvidence = createWorkflowEvidenceEnvelopeV1({
      producerId: "test-verifier",
      producerConfigDigest: DIGEST_A,
      observedAt: "2026-07-24T10:10:00Z",
      bindingDigest: DIGEST_B,
      value: { failure: "tests_failed" as const },
    });
    const schema = ReadbackResultV1Schema(VerificationSettledV1Schema, VerificationFailureSchema);
    expect(schema.safeParse({ kind: "failed", failure: "tests_failed", evidence: failureEvidence }).success).toBe(true);
    expect(schema.safeParse({ kind: "failed", failure: "typecheck_failed", evidence: failureEvidence }).success).toBe(false);
    expect(schema.safeParse({
      kind: "inconclusive",
      reason: "provider_pending",
      observedAt: "2026-07-24T10:10:00Z",
      unexpected: true,
    }).success).toBe(false);
  });

  it("digest-binds the external verifier descriptor", () => {
    const descriptor = {
      verifierId: "external-codex-readback",
      verifierConfigDigest: DIGEST_A,
      kind: "external_attended_readback_only" as const,
    };
    expect(computeExternalImplementationVerifierDescriptorDigest(descriptor)).toMatch(/^[0-9a-f]{64}$/);
    expect(computeExternalImplementationVerifierDescriptorDigest({ ...descriptor, verifierConfigDigest: DIGEST_B }))
      .not.toBe(computeExternalImplementationVerifierDescriptorDigest(descriptor));
  });
});

describe("orphan evidence", () => {
  it("creates a digest-bound report without any cleanup capability", () => {
    const report = createOrphanRefReportV1({
      runId: "run-host-001",
      stepId: "step-001",
      contractDigest: DIGEST_A,
      ref: canonicalFeatureRef("run-host-001", "step-001"),
      headSha: HEAD_SHA,
      pullRequestNumber: 18,
      pullRequestState: "open",
      failureReason: "merge_authority_missing",
      observedAt: "2026-07-24T10:30:00Z",
    });
    expect(verifyOrphanRefReportV1(report)).toBe(true);
    expect(verifyOrphanRefReportV1({ ...report, failureReason: "base_branch_advanced" })).toBe(false);
    expect(OrphanRefReportV1Schema.safeParse({ ...report, pullRequestNumber: null }).success).toBe(false);
    expect(OrphanRefReportV1Schema.safeParse({ ...report, deleteRef: true }).success).toBe(false);
  });
});

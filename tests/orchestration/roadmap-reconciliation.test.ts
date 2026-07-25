import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { domainSeparatedDigest } from "../../src/orchestration/canonical-json.js";
import {
  MAX_TRANSPARENT_META_COMMITS,
  ROADMAP_RECONCILIATION_POLICY_DIGEST,
  ROADMAP_RECONCILIATION_POLICY_V2_DIGEST,
  RoadmapBaseReconciliationProofV1Schema,
  RoadmapBaseReconciliationProofV2Schema,
  reconciliationBinding,
  verifyRoadmapBaseReconciliationProof,
  verifyRoadmapBaseReconciliationProofV1,
  TRANSPARENT_META_ALLOWED_PATHS,
  TRANSPARENT_META_FORBIDDEN_SURFACES,
} from "../../src/orchestration/roadmap-reconciliation.js";
import { bootstrapReconciliationProof, bootstrapReconciliationProofV2, PR18_MERGE_SHA } from "./reconciliation-support.js";

describe("roadmap base reconciliation", () => {
  it("pins the Claude-locked versioned contract and executable policy digest", async () => {
    const artifact = JSON.parse(await readFile(
      new URL("../../contracts/roadmap-base-reconciliation-v0.1.json", import.meta.url),
      "utf8",
    )) as Record<string, unknown>;
    const { contractDigest, ...payload } = artifact;
    expect(contractDigest).toBe(domainSeparatedDigest(
      "agent-builder/orchestration/roadmap-base-reconciliation-contract/v1",
      payload,
    ));
    expect(artifact["lockedStepContractDigest"]).toBe(
      "9dbecc775f5b6b368e08dbb77c023367ac2b92753ba9446ff2cf728b19281614",
    );
    const policy = artifact["policy"] as Record<string, unknown>;
    expect(policy["policyDigest"]).toBe(ROADMAP_RECONCILIATION_POLICY_DIGEST);
    expect(artifact["allowedTransparentPaths"]).toEqual([...TRANSPARENT_META_ALLOWED_PATHS]);
    expect([...(artifact["forbiddenTransparentSurfaces"] as string[])].sort()).toEqual(
      [...TRANSPARENT_META_FORBIDDEN_SURFACES].sort(),
    );
  });

  it("accepts the exact gap-free PR 17 and PR 18 governance chain", () => {
    const proof = bootstrapReconciliationProof();
    expect(verifyRoadmapBaseReconciliationProofV1(proof)).toBe(true);
    expect(proof).toMatchObject({
      domainBaseSha: "b3244c73ca79c68dbba3b4a05234f93d3ed92752",
      observedOriginMainSha: PR18_MERGE_SHA,
      policyDigest: ROADMAP_RECONCILIATION_POLICY_DIGEST,
      commits: [{ pullRequestNumber: 17 }, { pullRequestNumber: 18 }],
    });
    expect(reconciliationBinding(proof)).toEqual({
      schemaVersion: "roadmap-base-reconciliation-binding/1",
      policyDigest: ROADMAP_RECONCILIATION_POLICY_DIGEST,
      domainBaseSha: proof.domainBaseSha,
      observedOriginMainSha: proof.observedOriginMainSha,
      proofDigest: proof.proofDigest,
    });
  });

  it("rejects digest mutation, gaps, forks, duplicate provenance, and head drift", () => {
    const proof = bootstrapReconciliationProof();
    expect(verifyRoadmapBaseReconciliationProofV1({ ...proof, proofDigest: "0".repeat(64) })).toBe(false);
    expect(RoadmapBaseReconciliationProofV1Schema.safeParse({
      ...proof,
      commits: proof.commits.map((commit, index) => index === 1 ? { ...commit, parentSha: "0".repeat(40) } : commit),
    }).success).toBe(false);
    expect(RoadmapBaseReconciliationProofV1Schema.safeParse({
      ...proof,
      commits: [proof.commits[0], { ...proof.commits[1], pullRequestNumber: 17 }],
    }).success).toBe(false);
    expect(RoadmapBaseReconciliationProofV1Schema.safeParse({
      ...proof,
      observedOriginMainSha: "f".repeat(40),
    }).success).toBe(false);
  });

  it("rejects unknown provenance, wrong-head or failed CI, forbidden paths, and excessive depth", () => {
    const proof = bootstrapReconciliationProof();
    const first = proof.commits[0]!;
    const unsafe = (commit: unknown) => RoadmapBaseReconciliationProofV1Schema.safeParse({
      ...proof,
      commits: [commit, proof.commits[1]],
    }).success;
    expect(unsafe({ ...first, source: "direct_push" })).toBe(false);
    expect(unsafe({ ...first, requiredCheck: { ...first.requiredCheck, headSha: "e".repeat(40) } })).toBe(false);
    expect(unsafe({ ...first, requiredCheck: { ...first.requiredCheck, conclusion: "failure" } })).toBe(false);
    expect(unsafe({ ...first, workflowSafetyManifestDigest: "0".repeat(64) })).toBe(false);
    expect(unsafe({ ...first, changedPaths: [".github/workflows/ci.yml"] })).toBe(false);
    expect(unsafe({ ...first, changedPaths: ["src/runtime/authorize-runtime-action.ts"] })).toBe(false);
    expect(unsafe({ ...first, changedPaths: ["contracts/.env"] })).toBe(false);
    expect(unsafe({ ...first, changedPaths: ["docs/architecture/.env.production"] })).toBe(false);
    expect(unsafe({ ...first, changedPaths: ["docs/architecture/secrets/token.txt"] })).toBe(false);
    expect(unsafe({ ...first, changedPaths: ["src/orchestration/private.key"] })).toBe(false);
    expect(RoadmapBaseReconciliationProofV1Schema.safeParse({
      ...proof,
      commits: Array.from({ length: MAX_TRANSPARENT_META_COMMITS + 1 }, () => first),
    }).success).toBe(false);
  });

  it("pins the attended v2 migration artifact to the executable policy", async () => {
    const artifact = JSON.parse(await readFile(
      new URL("../../contracts/roadmap-base-reconciliation-v0.2.json", import.meta.url),
      "utf8",
    )) as Record<string, unknown>;
    const { contractDigest, ...payload } = artifact;
    expect((artifact["policy"] as Record<string, unknown>)["policyDigest"])
      .toBe(ROADMAP_RECONCILIATION_POLICY_V2_DIGEST);
    expect(contractDigest).toBe(domainSeparatedDigest(
      "agent-builder/orchestration/roadmap-base-reconciliation-contract/v2",
      payload,
    ));
  });

  it("accepts only the pinned PR 20 historical merge inside the bounded v2 chain", () => {
    const proof = bootstrapReconciliationProofV2();
    expect(verifyRoadmapBaseReconciliationProof(proof)).toBe(true);
    expect(proof.policyDigest).toBe(ROADMAP_RECONCILIATION_POLICY_V2_DIGEST);
    expect(proof.commits).toHaveLength(5);
    expect(proof.commits[3]).toMatchObject({ pullRequestNumber: 20, mergeMethod: "merge" });

    const reject = (commits: unknown) => RoadmapBaseReconciliationProofV2Schema.safeParse({
      ...proof,
      commits,
    }).success;
    expect(reject(proof.commits.map((commit, index) => index === 3
      ? { ...commit, pullRequestHeadSha: "0".repeat(40), requiredCheck: { ...commit.requiredCheck, headSha: "0".repeat(40) } }
      : commit))).toBe(false);
    expect(reject(proof.commits.map((commit, index) => index === 4 ? { ...commit, mergeMethod: "merge" } : commit))).toBe(false);
    expect(reject([...proof.commits, proof.commits[4]])).toBe(false);
    expect(reject(proof.commits.map((commit, index) => index === 4 ? { ...commit, pullRequestNumber: 20 } : commit))).toBe(false);
  });
});

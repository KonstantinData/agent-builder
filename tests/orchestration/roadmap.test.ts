import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  LockedStepContractV1Schema,
  RoadmapV1Schema,
  computeLockedContractDigest,
} from "../../src/orchestration/contracts.js";
import {
  selectNextRoadmapItem,
  validateActualDiff,
  type CommitReachabilityProof,
} from "../../src/orchestration/roadmap.js";
import { BASE_SHA, testIntent } from "./support.js";

async function loadRoadmap() {
  const text = await readFile(new URL("../../roadmap/agent-builder-roadmap.v1.json", import.meta.url), "utf8");
  return RoadmapV1Schema.parse(JSON.parse(text));
}

describe("machine-readable roadmap", () => {
  it("pins the versioned bootstrap contract identity and honest deferred model route", async () => {
    const text = await readFile(new URL("../../contracts/autonomous-roadmap-orchestration-v0.1.json", import.meta.url), "utf8");
    const contract = LockedStepContractV1Schema.parse(JSON.parse(text));
    const { contractDigest, ...payload } = contract;
    expect(contractDigest).toBe(computeLockedContractDigest(payload));
    expect(contract.routingDecision).toMatchObject({
      requestedModel: "gpt-5.6-sol",
      selectedModel: "gpt-5.6-terra",
      status: "deferred_to_next_task_start",
      fallbackDecision: "stop_if_unavailable",
    });
  });

  it("loads the real Step 1-15 merge baseline and uniquely selects Step 16", async () => {
    const roadmap = await loadRoadmap();
    const proofs: CommitReachabilityProof[] = roadmap.items
      .filter((item) => item.mergeCommitSha !== null)
      .map((item) => ({ commitSha: item.mergeCommitSha!, reachableFromOriginMain: true }));
    const result = selectNextRoadmapItem(roadmap, testIntent(), BASE_SHA, proofs);
    expect(roadmap.items.find((item) => item.stepId === "step-15")?.mergeCommitSha).toBe(BASE_SHA);
    expect(result).toMatchObject({ kind: "selected", item: { stepId: "step-16" } });
  });

  it("fails closed on unverified history and ambiguous eligible candidates", async () => {
    const roadmap = await loadRoadmap();
    expect(selectNextRoadmapItem(roadmap, testIntent(), BASE_SHA, [])).toMatchObject({
      kind: "stopped",
      reason: "roadmap_history_unverified",
    });
    const proofs = roadmap.items
      .filter((item) => item.mergeCommitSha !== null)
      .map((item) => ({ commitSha: item.mergeCommitSha!, reachableFromOriginMain: true }));
    const step16 = roadmap.items.find((item) => item.stepId === "step-16")!;
    expect(selectNextRoadmapItem(
      { ...roadmap, items: [...roadmap.items, { ...step16, stepId: "step-17" }] },
      testIntent(),
      BASE_SHA,
      proofs,
    )).toMatchObject({ kind: "stopped", reason: "roadmap_multiple_eligible" });
  });

  it("stops declared or actual scope from touching governance and orchestration", () => {
    expect(validateActualDiff(
      ["src/runtime/authorize-runtime-action.ts"],
      ["src/runtime/"],
    )).toEqual({ valid: true });
    expect(validateActualDiff([".github/workflows/deploy.yml"], [".github/"])).toMatchObject({
      valid: false,
      reason: "governance_touch",
    });
    expect(validateActualDiff(["src/orchestration/reducer.ts"], ["src/"])).toMatchObject({
      valid: false,
      reason: "governance_touch",
    });
    expect(validateActualDiff(["src/schema/new.ts"], ["src/runtime/"])).toMatchObject({
      valid: false,
      reason: "contract_scope_expansion",
    });
  });
});

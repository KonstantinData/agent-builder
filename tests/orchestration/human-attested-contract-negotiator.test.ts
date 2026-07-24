import { describe, expect, it } from "vitest";
import { HumanAttestedContractNegotiator } from "../../src/orchestration/human-attested-contract-negotiator.js";
import { computeHumanContractCandidateDigest, createHumanContractApprovalV1, type ModelRoutingDecisionV1 } from "../../src/orchestration/contracts.js";

const route: ModelRoutingDecisionV1 = {
  routingPolicyVersion: "model-routing/1",
  requestedModel: "gpt-5.6-terra",
  requestedReasoningEffort: "medium",
  selectedModel: "gpt-5.6-terra",
  reasoningEffort: "medium",
  triggers: [],
  triggerEvidence: {
    securityContract: false,
    majorArchitectureDecision: false,
    claudeContractConflict: false,
    unsuccessfulAttemptsInPhase: 0,
    contextComplexityUnits: 1,
    highContextComplexityThreshold: 2,
  },
  justification: "bounded test route",
  status: "applied" as const,
  attemptLimit: 1,
  observableBudget: { unit: "turns" as const, limit: 1 },
  fallbackDecision: "none" as const,
};

const request = {
  schemaVersion: "claude-negotiation-request/1" as const,
  runId: "run-human-lock",
  stepId: "step-16",
  baseRevision: "a".repeat(40),
  changeClass: "runtime_hardening" as const,
  allowedPaths: ["src/runtime/example.ts"],
  forbiddenSurfaces: [".github/"],
  successCriteria: ["pnpm test"],
  roundNumber: 1,
  priorRoundsSummary: "",
  routingDecision: route,
  baseReconciliation: null,
};

function approval(decision: "approved" | "rejected" = "approved") {
  return createHumanContractApprovalV1({
    schemaVersion: "human-contract-approval/1",
    runId: request.runId,
    stepId: request.stepId,
    baseRevision: request.baseRevision,
    baseReconciliation: null,
    candidateContractDigest: computeHumanContractCandidateDigest({
      schemaVersion: "locked-step-contract/1",
      runId: request.runId,
      stepId: request.stepId,
      baseRevision: request.baseRevision,
      changeClass: request.changeClass,
      capabilityEffect: "reduce_or_preserve",
      deploymentEffect: "none",
      allowedPaths: request.allowedPaths,
      forbiddenSurfaces: request.forbiddenSurfaces,
      successCriteria: request.successCriteria,
      maxClaudeRounds: 1,
      routingDecision: request.routingDecision,
      baseReconciliation: null,
      contractLockMode: "human_attested",
    }),
    attestorDescriptorDigest: "b".repeat(64),
    reviewerIdentityDigest: "c".repeat(64),
    decision,
    observedAt: "2026-07-24T18:00:00Z",
    expiresAt: "2099-07-24T18:00:00Z",
  });
}

describe("HumanAttestedContractNegotiator", () => {
  it("locks only an exact, unexpired, digest-bound human approval without invoking Claude", async () => {
    const result = await new HumanAttestedContractNegotiator(approval(), 1).negotiate(request);
    expect(result).toMatchObject({
      kind: "response",
      response: { kind: "locked", contract: { contractLockMode: "human_attested", humanApproval: { decision: "approved" } } },
    });
  });

  it("fails closed when the attested decision is rejected", async () => {
    await expect(new HumanAttestedContractNegotiator(approval("rejected"), 1).negotiate(request))
      .resolves.toEqual({ kind: "stopped", reason: "contract_malformed" });
  });
});

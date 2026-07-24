import {
  computeLockedContractDigest,
  createRunIntentV1,
  type LockedStepContractV1,
  type ModelRoutingDecisionV1,
  type RunIntentV1,
} from "../../src/orchestration/contracts.js";

export const BASE_SHA = "b3244c73ca79c68dbba3b4a05234f93d3ed92752";

export function testIntent(overrides: Partial<Parameters<typeof createRunIntentV1>[0]> = {}): RunIntentV1 {
  return createRunIntentV1({
    schemaVersion: "run-intent/1",
    intentId: "intent-001",
    repository: { host: "github", owner: "KonstantinData", name: "agent-builder" },
    baseRevision: BASE_SHA,
    issuedBy: "user-delegation",
    issuedAt: "2026-07-24T10:00:00Z",
    expiresAt: "2026-07-24T22:00:00Z",
    maxSteps: 3,
    maxClaudeRoundsPerStep: 4,
    maxAttemptsPerSideEffect: 2,
    allowedChangeClasses: ["runtime_hardening", "governance_meta"],
    allowFeatureBranchPush: true,
    allowPullRequestCreate: true,
    allowPullRequestMerge: true,
    allowDegradedModelFallback: false,
    ...overrides,
  });
}

export const terraRoute: ModelRoutingDecisionV1 = {
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
    contextComplexityUnits: 10_000,
    highContextComplexityThreshold: 100_000,
  },
  justification: "Default route for a new task or step boundary.",
  status: "applied",
  attemptLimit: 2,
  observableBudget: { unit: "turns", limit: 4 },
  fallbackDecision: "none",
};

export function testContract(overrides: Partial<Omit<LockedStepContractV1, "contractDigest">> = {}): LockedStepContractV1 {
  const base = {
    schemaVersion: "locked-step-contract/1" as const,
    runId: "run-001",
    stepId: "step-16",
    baseRevision: BASE_SHA,
    changeClass: "runtime_hardening" as const,
    capabilityEffect: "reduce_or_preserve" as const,
    deploymentEffect: "none" as const,
    allowedPaths: ["src/runtime/authorize-runtime-action.ts"],
    forbiddenSurfaces: [".github/"],
    successCriteria: ["pnpm typecheck", "pnpm test"],
    maxClaudeRounds: 4,
    routingDecision: terraRoute,
    ...overrides,
  };
  return { ...base, contractDigest: computeLockedContractDigest(base) };
}

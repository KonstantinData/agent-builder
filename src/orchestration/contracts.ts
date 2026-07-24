import { z } from "zod";
import { domainSeparatedDigest } from "./canonical-json.js";

export const GitShaSchema = z.string().regex(/^[0-9a-f]{40}$/);
export const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const Rfc3339InstantSchema = z.string().datetime({ offset: true });
export const IdentifierSchema = z.string().min(1).max(160).regex(/^[a-zA-Z0-9._:/-]+$/);

export const ChangeClassSchema = z.enum([
  "docs",
  "refactor",
  "runtime_hardening",
  "schema_hardening",
  "test_only",
  "governance_meta",
]);

export const CapabilityEffectSchema = z.enum(["reduce_or_preserve", "expand", "unknown"]);
export const DeploymentEffectSchema = z.enum(["none", "change", "unknown"]);

export const ModelIdSchema = z.enum(["gpt-5.6-terra", "gpt-5.6-sol"]);
export type ModelId = z.infer<typeof ModelIdSchema>;
export const ReasoningEffortSchema = z.enum(["medium", "high", "xhigh"]);
export const ModelRouteTriggerSchema = z.enum([
  "security_contract",
  "major_architecture_decision",
  "claude_contract_conflict",
  "repeated_solution_failure",
  "high_context_complexity",
]);
export type ModelRouteTrigger = z.infer<typeof ModelRouteTriggerSchema>;

export const ModelRoutingPolicyV1Schema = z
  .object({
    schemaVersion: z.literal("model-routing/1"),
    defaultModel: z.literal("gpt-5.6-terra"),
    defaultReasoningEffort: z.literal("medium"),
    escalationModel: z.literal("gpt-5.6-sol"),
    escalationReasoningEffort: z.enum(["high", "xhigh"]),
    highContextComplexityThreshold: z.number().int().positive(),
    repeatedFailureThreshold: z.literal(2),
  })
  .strict();
export type ModelRoutingPolicyV1 = z.infer<typeof ModelRoutingPolicyV1Schema>;

export const MODEL_ROUTING_POLICY_V1: ModelRoutingPolicyV1 = Object.freeze({
  schemaVersion: "model-routing/1",
  defaultModel: "gpt-5.6-terra",
  defaultReasoningEffort: "medium",
  escalationModel: "gpt-5.6-sol",
  escalationReasoningEffort: "high",
  highContextComplexityThreshold: 100_000,
  repeatedFailureThreshold: 2,
});

export const EnvironmentAttestationV1Schema = z
  .object({
    schemaVersion: z.literal("orchestration-environment/1"),
    executionMode: z.literal("attended_local"),
    ci: z.literal(false),
    nonInteractive: z.literal(false),
    observedAt: Rfc3339InstantSchema,
  })
  .strict();
export type EnvironmentAttestationV1 = z.infer<typeof EnvironmentAttestationV1Schema>;

export const RunStartEvidenceV1Schema = z
  .object({
    schemaVersion: z.literal("run-start-evidence/1"),
    environmentAttestationDigest: DigestSchema,
    environmentObservedAt: Rfc3339InstantSchema,
    intentVerificationDigest: DigestSchema,
    intentVerificationObservedAt: Rfc3339InstantSchema,
    roadmapDigest: DigestSchema,
  })
  .strict();
export type RunStartEvidenceV1 = z.infer<typeof RunStartEvidenceV1Schema>;

export const ModelRoutingDecisionV1Schema = z
  .object({
    routingPolicyVersion: z.literal("model-routing/1"),
    requestedModel: ModelIdSchema,
    requestedReasoningEffort: ReasoningEffortSchema,
    selectedModel: ModelIdSchema,
    reasoningEffort: ReasoningEffortSchema,
    triggers: z.array(ModelRouteTriggerSchema),
    triggerEvidence: z
      .object({
        securityContract: z.boolean(),
        majorArchitectureDecision: z.boolean(),
        claudeContractConflict: z.boolean(),
        unsuccessfulAttemptsInPhase: z.number().int().nonnegative(),
        contextComplexityUnits: z.number().int().nonnegative(),
        highContextComplexityThreshold: z.number().int().positive(),
      })
      .strict(),
    justification: z.string().min(1).max(2_000),
    status: z.enum(["applied", "deferred_to_next_task_start", "fallback_applied"]),
    attemptLimit: z.number().int().positive(),
    observableBudget: z
      .object({
        unit: z.enum(["turns", "tokens", "unavailable"]),
        limit: z.number().int().positive().nullable(),
      })
      .strict(),
    fallbackDecision: z.enum(["none", "authorized_degraded", "stop_if_unavailable"]),
  })
  .strict();
export type ModelRoutingDecisionV1 = z.infer<typeof ModelRoutingDecisionV1Schema>;

const RunIntentWithoutDigestSchema = z
  .object({
    schemaVersion: z.literal("run-intent/1"),
    intentId: IdentifierSchema,
    repository: z
      .object({
        host: z.literal("github"),
        owner: IdentifierSchema,
        name: IdentifierSchema,
      })
      .strict(),
    baseRevision: GitShaSchema,
    issuedBy: z.string().min(1).max(256),
    issuedAt: Rfc3339InstantSchema,
    expiresAt: Rfc3339InstantSchema,
    maxSteps: z.number().int().min(1).max(3),
    maxClaudeRoundsPerStep: z.number().int().min(1).max(4),
    maxAttemptsPerSideEffect: z.number().int().min(1).max(2),
    allowedChangeClasses: z.array(ChangeClassSchema).min(1),
    allowFeatureBranchPush: z.boolean(),
    allowPullRequestCreate: z.boolean(),
    allowPullRequestMerge: z.boolean(),
    allowDegradedModelFallback: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) {
      context.addIssue({ code: "custom", path: ["expiresAt"], message: "expiresAt must be after issuedAt" });
    }
    if (value.allowPullRequestMerge && (!value.allowPullRequestCreate || !value.allowFeatureBranchPush)) {
      context.addIssue({ code: "custom", path: ["allowPullRequestMerge"], message: "merge requires PR creation and feature-branch push" });
    }
  });

export const RunIntentV1Schema = RunIntentWithoutDigestSchema.and(
  z.object({ intentDigest: DigestSchema }).strict(),
);
export type RunIntentV1 = z.infer<typeof RunIntentV1Schema>;
export type RunIntentV1Input = z.input<typeof RunIntentWithoutDigestSchema>;

export function createRunIntentV1(input: RunIntentV1Input): RunIntentV1 {
  const parsed = RunIntentWithoutDigestSchema.parse(input);
  return RunIntentV1Schema.parse({
    ...parsed,
    intentDigest: domainSeparatedDigest("agent-builder/orchestration/run-intent/v1", parsed),
  });
}

export function verifyRunIntentDigest(intent: RunIntentV1): boolean {
  const { intentDigest: _ignored, ...payload } = RunIntentV1Schema.parse(intent);
  return intent.intentDigest === domainSeparatedDigest("agent-builder/orchestration/run-intent/v1", payload);
}

export const RoadmapItemV1Schema = z
  .object({
    schemaVersion: z.literal("roadmap-item/1"),
    stepId: IdentifierSchema,
    title: z.string().min(1).max(256),
    contractVersion: IdentifierSchema,
    dependencies: z.array(IdentifierSchema),
    changeClass: ChangeClassSchema,
    capabilityEffect: CapabilityEffectSchema,
    deploymentEffect: DeploymentEffectSchema,
    allowedPaths: z.array(z.string().min(1)).min(1),
    forbiddenSurfaces: z.array(z.string().min(1)),
    requiresHumanDecision: z.boolean(),
    expectedBaseMergeSha: GitShaSchema,
    mergeCommitSha: GitShaSchema.nullable(),
  })
  .strict();
export type RoadmapItemV1 = z.infer<typeof RoadmapItemV1Schema>;

export const RoadmapV1Schema = z
  .object({
    schemaVersion: z.literal("agent-builder-roadmap/1"),
    items: z.array(RoadmapItemV1Schema).min(1),
  })
  .strict();
export type RoadmapV1 = z.infer<typeof RoadmapV1Schema>;

export const LockedStepContractV1Schema = z
  .object({
    schemaVersion: z.literal("locked-step-contract/1"),
    runId: IdentifierSchema,
    stepId: IdentifierSchema,
    baseRevision: GitShaSchema,
    changeClass: ChangeClassSchema,
    capabilityEffect: z.literal("reduce_or_preserve"),
    deploymentEffect: z.literal("none"),
    allowedPaths: z.array(z.string().min(1)).min(1),
    forbiddenSurfaces: z.array(z.string().min(1)),
    successCriteria: z.array(z.string().min(1)).min(1),
    maxClaudeRounds: z.number().int().min(1).max(4),
    routingDecision: ModelRoutingDecisionV1Schema,
    controllerAddendum: z
      .object({
        schemaVersion: z.literal("attended-orchestration-controller/1"),
        maxTransitionsPerInvocation: z.literal(32),
        lockMode: z.literal("exclusive_no_wait_no_eviction"),
        automatedThroughPhase: z.literal("contract_locked"),
        externalImplementationBoundary: z.literal(true),
      })
      .strict()
      .optional(),
    contractDigest: DigestSchema,
  })
  .strict();
export type LockedStepContractV1 = z.infer<typeof LockedStepContractV1Schema>;

export function computeLockedContractDigest(
  contract: Omit<LockedStepContractV1, "contractDigest">,
): string {
  return domainSeparatedDigest("agent-builder/orchestration/locked-step-contract/v1", contract);
}

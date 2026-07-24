import { z } from "zod";
import { domainSeparatedDigest } from "./canonical-json.js";
import {
  CapabilityEffectSchema,
  ChangeClassSchema,
  DeploymentEffectSchema,
  DigestSchema,
  GitShaSchema,
  IdentifierSchema,
  ModelRoutingDecisionV1Schema,
  Rfc3339InstantSchema,
} from "./contracts.js";

const RUN_INTENT_V2_DOMAIN = "agent-builder/orchestration/run-intent/v2";
const LOCKED_STEP_CONTRACT_V2_DOMAIN = "agent-builder/orchestration/locked-step-contract/v2";
const WORKFLOW_EVIDENCE_V1_DOMAIN = "agent-builder/orchestration/workflow-evidence/v1";
const WORKFLOW_MANIFEST_V1_DOMAIN = "agent-builder/orchestration/workflow-safety-manifest/v1";
const EXTERNAL_VERIFIER_DESCRIPTOR_V1_DOMAIN =
  "agent-builder/orchestration/external-implementation-verifier-descriptor/v1";
const ORPHAN_REF_REPORT_V1_DOMAIN = "agent-builder/orchestration/orphan-ref-report/v1";

function validateIntentWindowAndMergeAuthority(
  value: {
    readonly issuedAt: string;
    readonly expiresAt: string;
    readonly allowFeatureBranchPush: boolean;
    readonly allowPullRequestCreate: boolean;
    readonly allowPullRequestMerge: boolean;
  },
  context: z.RefinementCtx,
): void {
  if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) {
    context.addIssue({ code: "custom", path: ["expiresAt"], message: "expiresAt must be after issuedAt" });
  }
  if (value.allowPullRequestMerge && (!value.allowPullRequestCreate || !value.allowFeatureBranchPush)) {
    context.addIssue({
      code: "custom",
      path: ["allowPullRequestMerge"],
      message: "merge requires PR creation and feature-branch push",
    });
  }
}

const RunIntentV2WithoutDigestSchema = z
  .object({
    schemaVersion: z.literal("run-intent/2"),
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
    maxCiReadsPerStep: z.number().int().min(1).max(3).default(3),
    allowedChangeClasses: z.array(ChangeClassSchema).min(1),
    allowFeatureBranchPush: z.boolean(),
    allowPullRequestCreate: z.boolean(),
    allowPullRequestMerge: z.boolean(),
    allowDegradedModelFallback: z.boolean(),
  })
  .strict()
  .superRefine(validateIntentWindowAndMergeAuthority);

export const RunIntentV2Schema = RunIntentV2WithoutDigestSchema.and(
  z.object({ intentDigest: DigestSchema }).strict(),
);
export type RunIntentV2 = z.infer<typeof RunIntentV2Schema>;
export type RunIntentV2Input = z.input<typeof RunIntentV2WithoutDigestSchema>;

export function createRunIntentV2(input: RunIntentV2Input): RunIntentV2 {
  const parsed = RunIntentV2WithoutDigestSchema.parse(input);
  return RunIntentV2Schema.parse({
    ...parsed,
    intentDigest: domainSeparatedDigest(RUN_INTENT_V2_DOMAIN, parsed),
  });
}

export function verifyRunIntentV2Digest(intent: RunIntentV2): boolean {
  const parsed = RunIntentV2Schema.safeParse(intent);
  if (!parsed.success) return false;
  const { intentDigest, ...payload } = parsed.data;
  return intentDigest === domainSeparatedDigest(RUN_INTENT_V2_DOMAIN, payload);
}

export const RunStartEvidenceV2Schema = z
  .object({
    schemaVersion: z.literal("run-start-evidence/2"),
    environmentAttestationDigest: DigestSchema,
    environmentObservedAt: Rfc3339InstantSchema,
    intentVerificationDigest: DigestSchema,
    intentVerificationObservedAt: Rfc3339InstantSchema,
    roadmapDigest: DigestSchema,
    workflowAdapterRegistryDigest: DigestSchema,
    externalImplementationVerifierDescriptorDigest: DigestSchema,
    workflowSafetyManifestDigest: DigestSchema,
  })
  .strict();
export type RunStartEvidenceV2 = z.infer<typeof RunStartEvidenceV2Schema>;

export const RepoRelativePathSchema = z.string().min(1).max(512).superRefine((path, context) => {
  if (path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    context.addIssue({ code: "custom", message: "path must be repository-relative and slash-normalized" });
  }
  if (path.split("/").some((part) => part === "" || part === "." || part === "..")) {
    context.addIssue({ code: "custom", message: "path contains an empty or traversal segment" });
  }
});

export const SortedUniqueRepoPathsSchema = z.array(RepoRelativePathSchema).superRefine((paths, context) => {
  const sorted = [...new Set(paths)].sort();
  if (sorted.length !== paths.length || sorted.some((path, index) => path !== paths[index])) {
    context.addIssue({ code: "custom", message: "paths must be sorted and unique" });
  }
});
export type SortedUniqueRepoPaths = z.infer<typeof SortedUniqueRepoPathsSchema>;

const ContractScopePathSchema = z.string().min(1).max(512).superRefine((path, context) => {
  if (path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    context.addIssue({ code: "custom", message: "scope path must be repository-relative and slash-normalized" });
  }
  const withoutOptionalTrailingSlash = path.endsWith("/") ? path.slice(0, -1) : path;
  if (
    withoutOptionalTrailingSlash.length === 0 ||
    withoutOptionalTrailingSlash.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    context.addIssue({ code: "custom", message: "scope path contains an empty or traversal segment" });
  }
});

export const SortedUniqueContractScopePathsSchema = z
  .array(ContractScopePathSchema)
  .superRefine((paths, context) => {
    const sorted = [...new Set(paths)].sort();
    if (sorted.length !== paths.length || sorted.some((path, index) => path !== paths[index])) {
      context.addIssue({ code: "custom", message: "scope paths must be sorted and unique" });
    }
  });

export const RequiredChecksV1Schema = z.tuple([z.literal("verify")]);
export type RequiredChecksV1 = z.infer<typeof RequiredChecksV1Schema>;

export const WorkflowSafetyManifestEntryV1Schema = z
  .object({
    path: z.string().regex(/^\.github\/workflows\/[^/]+\.ya?ml$/),
    blobSha256: DigestSchema,
    classification: z.literal("verification_only"),
    requiredChecks: RequiredChecksV1Schema,
  })
  .strict();
export type WorkflowSafetyManifestEntryV1 = z.infer<typeof WorkflowSafetyManifestEntryV1Schema>;

export const WorkflowSafetyManifestPayloadV1Schema = z
  .object({
    schemaVersion: z.literal("workflow-safety-manifest/1"),
    workflows: z.array(WorkflowSafetyManifestEntryV1Schema).min(1).superRefine((workflows, context) => {
      const paths = workflows.map((workflow) => workflow.path);
      const sorted = [...new Set(paths)].sort();
      if (sorted.length !== paths.length || sorted.some((path, index) => path !== paths[index])) {
        context.addIssue({ code: "custom", message: "workflow entries must be sorted and unique by path" });
      }
    }),
  })
  .strict();

export const WorkflowSafetyManifestV1Schema = WorkflowSafetyManifestPayloadV1Schema.and(
  z.object({ manifestDigest: DigestSchema }).strict(),
);
export type WorkflowSafetyManifestV1 = z.infer<typeof WorkflowSafetyManifestV1Schema>;
export type WorkflowSafetyManifestV1Input = z.input<typeof WorkflowSafetyManifestPayloadV1Schema>;

export function computeWorkflowSafetyManifestDigest(
  manifest: WorkflowSafetyManifestV1Input,
): string {
  return domainSeparatedDigest(WORKFLOW_MANIFEST_V1_DOMAIN, WorkflowSafetyManifestPayloadV1Schema.parse(manifest));
}

export function createWorkflowSafetyManifestV1(
  manifest: WorkflowSafetyManifestV1Input,
): WorkflowSafetyManifestV1 {
  const parsed = WorkflowSafetyManifestPayloadV1Schema.parse(manifest);
  return WorkflowSafetyManifestV1Schema.parse({
    ...parsed,
    manifestDigest: domainSeparatedDigest(WORKFLOW_MANIFEST_V1_DOMAIN, parsed),
  });
}

export function verifyWorkflowSafetyManifest(manifest: WorkflowSafetyManifestV1): boolean {
  const parsed = WorkflowSafetyManifestV1Schema.safeParse(manifest);
  if (!parsed.success) return false;
  const { manifestDigest, ...payload } = parsed.data;
  return manifestDigest === domainSeparatedDigest(WORKFLOW_MANIFEST_V1_DOMAIN, payload);
}

const LockedStepContractV2WithoutDigestSchema = z
  .object({
    schemaVersion: z.literal("locked-step-contract/2"),
    runId: IdentifierSchema,
    stepId: IdentifierSchema,
    baseRevision: GitShaSchema,
    changeClass: ChangeClassSchema,
    capabilityEffect: CapabilityEffectSchema.pipe(z.literal("reduce_or_preserve")),
    deploymentEffect: DeploymentEffectSchema.pipe(z.literal("none")),
    allowedPaths: SortedUniqueContractScopePathsSchema.min(1),
    forbiddenSurfaces: SortedUniqueContractScopePathsSchema,
    successCriteria: z.array(z.string().min(1)).min(1),
    maxClaudeRounds: z.number().int().min(1).max(4),
    routingDecision: ModelRoutingDecisionV1Schema,
    requiredChecks: RequiredChecksV1Schema,
    workflowSafetyManifestDigest: DigestSchema,
    controllerAddendum: z
      .object({
        schemaVersion: z.literal("host-workflow-controller/1"),
        maxTransitionsPerInvocation: z.literal(32),
        lockMode: z.literal("exclusive_no_wait_no_eviction"),
        automatedThroughPhase: z.literal("step_complete"),
        externalImplementationMode: z.literal("external_attended_readback_only"),
        branchDeletionAllowed: z.literal(false),
      })
      .strict(),
  })
  .strict();

export const LockedStepContractV2Schema = LockedStepContractV2WithoutDigestSchema.and(
  z.object({ contractDigest: DigestSchema }).strict(),
);
export type LockedStepContractV2 = z.infer<typeof LockedStepContractV2Schema>;
export type LockedStepContractV2Input = z.input<typeof LockedStepContractV2WithoutDigestSchema>;

export function computeLockedStepContractV2Digest(contract: LockedStepContractV2Input): string {
  return domainSeparatedDigest(
    LOCKED_STEP_CONTRACT_V2_DOMAIN,
    LockedStepContractV2WithoutDigestSchema.parse(contract),
  );
}

export function createLockedStepContractV2(contract: LockedStepContractV2Input): LockedStepContractV2 {
  const parsed = LockedStepContractV2WithoutDigestSchema.parse(contract);
  return LockedStepContractV2Schema.parse({
    ...parsed,
    contractDigest: domainSeparatedDigest(LOCKED_STEP_CONTRACT_V2_DOMAIN, parsed),
  });
}

export function verifyLockedStepContractV2Digest(contract: LockedStepContractV2): boolean {
  const parsed = LockedStepContractV2Schema.safeParse(contract);
  if (!parsed.success) return false;
  const { contractDigest, ...payload } = parsed.data;
  return contractDigest === domainSeparatedDigest(LOCKED_STEP_CONTRACT_V2_DOMAIN, payload);
}

export interface WorkflowEvidenceEnvelopeV1<T> {
  readonly schemaVersion: "workflow-evidence/1";
  readonly producerId: string;
  readonly producerConfigDigest: string;
  readonly observedAt: string;
  readonly bindingDigest: string;
  readonly value: T;
  readonly evidenceDigest: string;
}

export function WorkflowEvidenceEnvelopeV1Schema<T extends z.ZodType>(valueSchema: T) {
  return z
    .object({
      schemaVersion: z.literal("workflow-evidence/1"),
      producerId: IdentifierSchema,
      producerConfigDigest: DigestSchema,
      observedAt: Rfc3339InstantSchema,
      bindingDigest: DigestSchema,
      value: valueSchema,
      evidenceDigest: DigestSchema,
    })
    .strict();
}

export function createWorkflowEvidenceEnvelopeV1<T>(input: {
  readonly producerId: string;
  readonly producerConfigDigest: string;
  readonly observedAt: string;
  readonly bindingDigest: string;
  readonly value: T;
}): WorkflowEvidenceEnvelopeV1<T> {
  const base = WorkflowEvidenceEnvelopeV1Schema(z.unknown())
    .omit({ evidenceDigest: true })
    .parse({ schemaVersion: "workflow-evidence/1", ...input });
  return {
    ...base,
    value: input.value,
    evidenceDigest: domainSeparatedDigest(WORKFLOW_EVIDENCE_V1_DOMAIN, base),
  };
}

export function verifyWorkflowEvidenceEnvelopeV1<T>(
  evidence: WorkflowEvidenceEnvelopeV1<T>,
  valueSchema: z.ZodType<T>,
  expectedBindingDigest?: string,
): boolean {
  const parsed = WorkflowEvidenceEnvelopeV1Schema(valueSchema).safeParse(evidence);
  if (!parsed.success || (expectedBindingDigest !== undefined && parsed.data.bindingDigest !== expectedBindingDigest)) {
    return false;
  }
  const { evidenceDigest, ...payload } = parsed.data;
  return evidenceDigest === domainSeparatedDigest(WORKFLOW_EVIDENCE_V1_DOMAIN, payload);
}

export const ReadbackInconclusiveV1Schema = z
  .object({
    kind: z.literal("inconclusive"),
    reason: z.enum([
      "not_found",
      "multiple_matches",
      "provider_pending",
      "provider_unavailable",
      "response_untrustworthy",
    ]),
    observedAt: Rfc3339InstantSchema,
    responseDigest: DigestSchema.optional(),
  })
  .strict();
export type ReadbackInconclusiveV1 = z.infer<typeof ReadbackInconclusiveV1Schema>;

export function ReadbackResultV1Schema<T extends z.ZodType, F extends z.ZodType<string>>(
  settledValueSchema: T,
  failureSchema: F,
) {
  const settled = z
    .object({
      kind: z.literal("settled"),
      evidence: WorkflowEvidenceEnvelopeV1Schema(settledValueSchema),
    })
    .strict();
  const failed = z
    .object({
      kind: z.literal("failed"),
      failure: failureSchema,
      evidence: WorkflowEvidenceEnvelopeV1Schema(z.object({ failure: failureSchema }).strict()),
    })
    .strict()
    .superRefine((value, context) => {
      const candidate = value as unknown as {
        readonly failure: string;
        readonly evidence: { readonly value: { readonly failure: string } };
      };
      if (candidate.failure !== candidate.evidence.value.failure) {
        context.addIssue({ code: "custom", path: ["evidence", "value", "failure"], message: "failure evidence must match failure" });
      }
    });
  return z.union([settled, failed, ReadbackInconclusiveV1Schema]);
}

export type WorkflowReadbackResultV1<T, F extends string> =
  | { readonly kind: "settled"; readonly evidence: WorkflowEvidenceEnvelopeV1<T> }
  | {
      readonly kind: "failed";
      readonly failure: F;
      readonly evidence: WorkflowEvidenceEnvelopeV1<{ readonly failure: F }>;
    }
  | ReadbackInconclusiveV1;

export const WorkflowAdapterDescriptorV1Schema = z
  .object({
    schemaVersion: z.literal("workflow-adapter-descriptor/1"),
    adapterId: IdentifierSchema,
    adapterConfigDigest: DigestSchema,
    kind: z.enum([
      "external_attended_readback_only",
      "verification",
      "feature_ref",
      "pull_request",
      "ci_read_only",
      "merge_gate_read_only",
      "cleanup_read_only",
      "merge",
    ]),
  })
  .strict();
export type WorkflowAdapterDescriptorV1 = z.infer<typeof WorkflowAdapterDescriptorV1Schema>;

export const ExternalImplementationVerifierDescriptorV1Schema = z
  .object({
    verifierId: IdentifierSchema,
    verifierConfigDigest: DigestSchema,
    kind: z.literal("external_attended_readback_only"),
  })
  .strict();
export type ExternalImplementationVerifierDescriptorV1 = z.infer<
  typeof ExternalImplementationVerifierDescriptorV1Schema
>;

export function computeExternalImplementationVerifierDescriptorDigest(
  descriptor: ExternalImplementationVerifierDescriptorV1,
): string {
  return domainSeparatedDigest(
    EXTERNAL_VERIFIER_DESCRIPTOR_V1_DOMAIN,
    ExternalImplementationVerifierDescriptorV1Schema.parse(descriptor),
  );
}

export const EffectBindingV1Schema = z
  .object({
    idempotencyKey: DigestSchema,
    runId: IdentifierSchema,
    stepId: IdentifierSchema,
    contractDigest: DigestSchema,
    lockedBaseSha: GitShaSchema,
    headSha: GitShaSchema,
  })
  .strict();
export type EffectBindingV1 = z.infer<typeof EffectBindingV1Schema>;

export const ExternalImplementationReadbackRequestV1Schema = EffectBindingV1Schema.extend({
  expectedAllowedPaths: SortedUniqueRepoPathsSchema,
}).strict();
export type ExternalImplementationReadbackRequestV1 = z.infer<
  typeof ExternalImplementationReadbackRequestV1Schema
>;

export const ExternalImplementationSettledV1Schema = EffectBindingV1Schema.extend({
  changedPaths: SortedUniqueRepoPathsSchema,
  cleanWorktree: z.literal(true),
  baseIsAncestor: z.literal(true),
}).strict();
export type ExternalImplementationSettledV1 = z.infer<typeof ExternalImplementationSettledV1Schema>;
export const ExternalImplementationFailureSchema = z.enum([
  "binding_mismatch",
  "dirty_worktree",
  "base_not_ancestor",
  "diff_outside_contract",
  "forbidden_surface",
  "head_unavailable",
  "evidence_untrustworthy",
]);
export type ExternalImplementationFailure = z.infer<typeof ExternalImplementationFailureSchema>;

export const VerificationSettledV1Schema = EffectBindingV1Schema.pick({
  idempotencyKey: true,
  runId: true,
  stepId: true,
  contractDigest: true,
  headSha: true,
})
  .extend({
    changedPaths: SortedUniqueRepoPathsSchema,
    typecheckPassed: z.literal(true),
    testsPassed: z.literal(true),
    diffWithinContract: z.literal(true),
    touchesGovernance: z.literal(false),
    capabilityExpanded: z.literal(false),
    deploymentChanged: z.literal(false),
  })
  .strict();
export type VerificationSettledV1 = z.infer<typeof VerificationSettledV1Schema>;
export const VerificationFailureSchema = z.enum([
  "typecheck_failed",
  "tests_failed",
  "diff_outside_contract",
  "forbidden_surface",
  "capability_expansion",
  "deployment_change",
  "evidence_untrustworthy",
]);
export type VerificationFailure = z.infer<typeof VerificationFailureSchema>;

const FeatureRefComponentSchema = z.string().min(1).max(160).regex(/^[a-zA-Z0-9._:-]+$/);
export const CanonicalFeatureRefSchema = z
  .string()
  .regex(/^refs\/heads\/orchestration\/[a-zA-Z0-9._:-]+\/[a-zA-Z0-9._:-]+$/);

export function canonicalFeatureRef(runId: string, stepId: string): string {
  return CanonicalFeatureRefSchema.parse(
    `refs/heads/orchestration/${FeatureRefComponentSchema.parse(runId)}/${FeatureRefComponentSchema.parse(stepId)}`,
  );
}

export function isCanonicalFeatureRef(ref: string, runId: string, stepId: string): boolean {
  try {
    return ref === canonicalFeatureRef(runId, stepId);
  } catch {
    return false;
  }
}

export const FeatureRefInvocationV1Schema = EffectBindingV1Schema.extend({
  remoteName: IdentifierSchema,
  ref: CanonicalFeatureRefSchema,
}).strict();
export type FeatureRefInvocationV1 = z.infer<typeof FeatureRefInvocationV1Schema>;

export const FeatureRefSettledV1Schema = EffectBindingV1Schema.pick({
  idempotencyKey: true,
  lockedBaseSha: true,
  headSha: true,
})
  .extend({ remoteName: IdentifierSchema, ref: CanonicalFeatureRefSchema })
  .strict();
export type FeatureRefSettledV1 = z.infer<typeof FeatureRefSettledV1Schema>;
export const FeatureRefFailureSchema = z.enum([
  "dirty_worktree",
  "head_mismatch",
  "base_not_ancestor",
  "default_branch_target",
  "protected_branch_target",
  "refspec_invalid",
  "remote_untrusted",
  "remote_ref_conflict",
  "provider_error",
]);
export type FeatureRefFailure = z.infer<typeof FeatureRefFailureSchema>;

export const PullRequestInvocationV1Schema = EffectBindingV1Schema.extend({
  headRef: CanonicalFeatureRefSchema,
  baseRef: z.string().min(1).max(256),
  titleDigest: DigestSchema,
  bodyDigest: DigestSchema,
  machineBlockDigest: DigestSchema,
}).strict();
export type PullRequestInvocationV1 = z.infer<typeof PullRequestInvocationV1Schema>;

export const PullRequestSettledV1Schema = z
  .object({
    idempotencyKey: DigestSchema,
    number: z.number().int().positive(),
    state: z.literal("open"),
    draft: z.literal(false),
    headRef: CanonicalFeatureRefSchema,
    headSha: GitShaSchema,
    baseRef: z.string().min(1).max(256),
    baseSha: GitShaSchema,
    mergeable: z.enum(["mergeable", "unknown"]),
    machineBlockDigest: DigestSchema,
  })
  .strict();
export type PullRequestSettledV1 = z.infer<typeof PullRequestSettledV1Schema>;
export const PullRequestFailureSchema = z.enum([
  "multiple_matching_prs",
  "closed_without_merge",
  "already_merged_unexpectedly",
  "head_mismatch",
  "base_mismatch",
  "machine_block_mismatch",
  "provider_error",
  "evidence_untrustworthy",
]);
export type PullRequestFailure = z.infer<typeof PullRequestFailureSchema>;

export const CiCheckV1Schema = z
  .object({
    name: z.literal("verify"),
    headSha: GitShaSchema,
    status: z.enum(["queued", "in_progress", "waiting", "pending", "completed"]),
    conclusion: z
      .enum(["success", "failure", "cancelled", "timed_out", "action_required", "startup_failure"])
      .nullable(),
  })
  .strict()
  .superRefine((check, context) => {
    if (check.status === "completed" && check.conclusion === null) {
      context.addIssue({ code: "custom", path: ["conclusion"], message: "completed check requires a conclusion" });
    }
    if (check.status !== "completed" && check.conclusion !== null) {
      context.addIssue({ code: "custom", path: ["conclusion"], message: "nonterminal check cannot have a conclusion" });
    }
  });

export const CiObservationV1Schema = z
  .object({
    pullRequestNumber: z.number().int().positive(),
    headSha: GitShaSchema,
    requiredChecks: RequiredChecksV1Schema,
    checks: z.array(CiCheckV1Schema),
  })
  .strict();
export type CiObservationV1 = z.infer<typeof CiObservationV1Schema>;

export const MergeGateObservationV1Schema = z
  .object({
    defaultBranchHeadSha: GitShaSchema,
    lockedBaseSha: GitShaSchema,
    defaultBranchProtected: z.boolean(),
    requiredChecks: RequiredChecksV1Schema,
    requiredReviewCount: z.number().int().nonnegative(),
    reviewsSatisfied: z.boolean(),
    adminBypassAllowed: z.boolean(),
    bypassUsed: z.boolean(),
    pullRequestNumber: z.number().int().positive(),
    pullRequestOpen: z.boolean(),
    pullRequestMergeable: z.boolean(),
    headSha: GitShaSchema,
    expectedHeadSha: GitShaSchema,
    baseSha: GitShaSchema,
    machineBlockMatches: z.boolean(),
    requiredChecksPassed: z.boolean(),
    workflowManifestSafe: z.boolean(),
    workflowSafetyEvidenceDigest: DigestSchema,
    diffWithinContract: z.boolean(),
    forbiddenSurfaceTouched: z.boolean(),
    capabilityExpanded: z.boolean(),
    deploymentChanged: z.boolean(),
  })
  .strict();
export type MergeGateObservationV1 = z.infer<typeof MergeGateObservationV1Schema>;

export const MergeSettledV1Schema = z
  .object({
    idempotencyKey: DigestSchema,
    pullRequestNumber: z.number().int().positive(),
    expectedHeadSha: GitShaSchema,
    lockedBaseSha: GitShaSchema,
    mergeCommitSha: GitShaSchema,
    state: z.literal("merged"),
    mergeCommitReachableFromOriginMain: z.literal(true),
  })
  .strict();
export type MergeSettledV1 = z.infer<typeof MergeSettledV1Schema>;
export const MergeFailureSchema = z.enum([
  "merge_authority_missing",
  "base_branch_advanced",
  "checks_unsatisfied",
  "review_unsatisfied",
  "workflow_state_unknown",
  "pr_not_mergeable",
  "head_mismatch",
  "merge_rejected",
  "merge_readback_unreachable",
  "evidence_untrustworthy",
]);
export type MergeFailure = z.infer<typeof MergeFailureSchema>;

export const OrphanRefReportV1Schema = z
  .object({
    schemaVersion: z.literal("orphan-ref-report/1"),
    runId: IdentifierSchema,
    stepId: IdentifierSchema,
    contractDigest: DigestSchema,
    ref: CanonicalFeatureRefSchema,
    headSha: GitShaSchema,
    pullRequestNumber: z.number().int().positive().nullable(),
    pullRequestState: z.enum(["not_created", "open", "closed", "merged", "unknown"]),
    failureReason: z.string().min(1).max(256),
    observedAt: Rfc3339InstantSchema,
    evidenceDigest: DigestSchema,
  })
  .strict()
  .superRefine((report, context) => {
    if (report.pullRequestState === "not_created" && report.pullRequestNumber !== null) {
      context.addIssue({ code: "custom", path: ["pullRequestNumber"], message: "not-created PR cannot have a number" });
    }
    if (report.pullRequestState !== "not_created" && report.pullRequestNumber === null) {
      context.addIssue({ code: "custom", path: ["pullRequestNumber"], message: "known PR state requires a number" });
    }
  });
export type OrphanRefReportV1 = z.infer<typeof OrphanRefReportV1Schema>;

export type OrphanRefReportV1Input = Omit<OrphanRefReportV1, "schemaVersion" | "evidenceDigest">;

export function createOrphanRefReportV1(input: OrphanRefReportV1Input): OrphanRefReportV1 {
  const base = { schemaVersion: "orphan-ref-report/1" as const, ...input };
  return OrphanRefReportV1Schema.parse({
    ...base,
    evidenceDigest: domainSeparatedDigest(ORPHAN_REF_REPORT_V1_DOMAIN, base),
  });
}

export function verifyOrphanRefReportV1(report: OrphanRefReportV1): boolean {
  const parsed = OrphanRefReportV1Schema.safeParse(report);
  if (!parsed.success) return false;
  const { evidenceDigest, ...payload } = parsed.data;
  return evidenceDigest === domainSeparatedDigest(ORPHAN_REF_REPORT_V1_DOMAIN, payload);
}

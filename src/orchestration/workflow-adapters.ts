import { domainSeparatedDigest } from "./canonical-json.js";
import {
  CiObservationV1Schema,
  WorkflowAdapterDescriptorV1Schema,
  type CiObservationV1,
  type EffectBindingV1,
  type ExternalImplementationFailure,
  type ExternalImplementationReadbackRequestV1,
  type ExternalImplementationSettledV1,
  type FeatureRefFailure,
  type FeatureRefInvocationV1,
  type FeatureRefSettledV1,
  type MergeFailure,
  type MergeGateObservationV1,
  type MergeSettledV1,
  type PullRequestFailure,
  type PullRequestInvocationV1,
  type PullRequestSettledV1,
  type VerificationFailure,
  type VerificationSettledV1,
  type WorkflowAdapterDescriptorV1,
  type WorkflowEvidenceEnvelopeV1,
  type WorkflowReadbackResultV1,
  type WorkflowSafetyManifestV1,
} from "./host-workflow-contracts.js";

export interface ExternalImplementationVerifier {
  readonly descriptor: WorkflowAdapterDescriptorV1;
  readback(input: ExternalImplementationReadbackRequestV1): Promise<
    WorkflowReadbackResultV1<ExternalImplementationSettledV1, ExternalImplementationFailure>
  >;
}

export interface StatefulWorkflowAdapter<I, T, F extends string> {
  readonly descriptor: WorkflowAdapterDescriptorV1;
  invoke(input: I): Promise<void>;
  readback(input: I): Promise<WorkflowReadbackResultV1<T, F>>;
}

export type VerificationAdapter = StatefulWorkflowAdapter<EffectBindingV1, VerificationSettledV1, VerificationFailure>;
export type FeatureRefAdapter = StatefulWorkflowAdapter<FeatureRefInvocationV1, FeatureRefSettledV1, FeatureRefFailure>;
export type PullRequestAdapter = StatefulWorkflowAdapter<PullRequestInvocationV1, PullRequestSettledV1, PullRequestFailure>;

export interface CiStatusReader {
  readonly descriptor: WorkflowAdapterDescriptorV1;
  read(input: { readonly pullRequestNumber: number; readonly headSha: string }): Promise<WorkflowEvidenceEnvelopeV1<CiObservationV1>>;
}

export interface MergeGateInspector {
  readonly descriptor: WorkflowAdapterDescriptorV1;
  read(input: EffectBindingV1 & {
    readonly pullRequestNumber: number;
    readonly machineBlockDigest: string;
    readonly workflowManifest: WorkflowSafetyManifestV1;
  }): Promise<WorkflowEvidenceEnvelopeV1<MergeGateObservationV1>>;
}

export type MergeInvocationV1 = EffectBindingV1 & { readonly pullRequestNumber: number };
export type MergeAdapter = StatefulWorkflowAdapter<MergeInvocationV1, MergeSettledV1, MergeFailure>;

export interface CleanupVerifier {
  readonly descriptor: WorkflowAdapterDescriptorV1;
  read(input: {
    readonly runId: string;
    readonly stepId: string;
    readonly contractDigest: string;
    readonly pullRequestNumber: number;
    readonly headSha: string;
  }): Promise<WorkflowEvidenceEnvelopeV1<{ readonly localWorktreeClean: true; readonly branchDeletionPerformed: false }>>;
}

export interface HostWorkflowAdapters {
  readonly externalImplementation?: ExternalImplementationVerifier;
  readonly verification?: VerificationAdapter;
  readonly featureRef?: FeatureRefAdapter;
  readonly pullRequest?: PullRequestAdapter;
  readonly ci?: CiStatusReader;
  readonly mergeGate?: MergeGateInspector;
  readonly merge?: MergeAdapter;
  readonly cleanup?: CleanupVerifier;
}

const EXPECTED_KINDS = Object.freeze({
  externalImplementation: "external_attended_readback_only",
  verification: "verification",
  featureRef: "feature_ref",
  pullRequest: "pull_request",
  ci: "ci_read_only",
  mergeGate: "merge_gate_read_only",
  merge: "merge",
  cleanup: "cleanup_read_only",
} as const);

const STATEFUL_KEYS = ["verification", "featureRef", "pullRequest", "merge"] as const;

export function validateHostWorkflowAdapters(adapters: HostWorkflowAdapters): void {
  for (const key of STATEFUL_KEYS) {
    const adapter = adapters[key] as unknown as Record<string, unknown> | undefined;
    if (adapter !== undefined && (typeof adapter["invoke"] !== "function" || typeof adapter["readback"] !== "function")) {
      throw new TypeError(`${key} adapter must register invoke and readback together`);
    }
  }
  for (const [key, adapter, method] of [
    ["externalImplementation", adapters.externalImplementation, "readback"],
    ["ci", adapters.ci, "read"],
    ["mergeGate", adapters.mergeGate, "read"],
    ["cleanup", adapters.cleanup, "read"],
  ] as const) {
    if (adapter !== undefined && typeof (adapter as unknown as Record<string, unknown>)[method] !== "function") {
      throw new TypeError(`${key} adapter is incomplete`);
    }
  }
  for (const [key, expectedKind] of Object.entries(EXPECTED_KINDS)) {
    const adapter = adapters[key as keyof HostWorkflowAdapters];
    if (adapter === undefined) continue;
    const descriptor = WorkflowAdapterDescriptorV1Schema.parse(adapter.descriptor);
    if (descriptor.kind !== expectedKind) throw new TypeError(`${key} adapter descriptor kind is invalid`);
  }
}

export function workflowAdapterRegistryDigest(adapters: HostWorkflowAdapters): string {
  validateHostWorkflowAdapters(adapters);
  const descriptors = Object.values(adapters)
    .filter((adapter): adapter is NonNullable<typeof adapter> => adapter !== undefined)
    .map((adapter) => WorkflowAdapterDescriptorV1Schema.parse(adapter.descriptor))
    .sort((left, right) => left.adapterId.localeCompare(right.adapterId));
  return domainSeparatedDigest("agent-builder/orchestration/workflow-adapter-registry/v1", descriptors);
}

export function workflowEffectBindingDigest(input: Readonly<Record<string, unknown>>): string {
  return domainSeparatedDigest("agent-builder/orchestration/workflow-effect-binding/v1", input);
}

export type CiEvaluation =
  | { readonly kind: "passed" }
  | { readonly kind: "pending" }
  | { readonly kind: "failed"; readonly reason: "ci_failed" | "ci_response_untrustworthy" };

export function evaluateCiObservation(observation: CiObservationV1): CiEvaluation {
  const parsed = CiObservationV1Schema.safeParse(observation);
  if (!parsed.success || parsed.data.checks.length !== 1) return { kind: "failed", reason: "ci_response_untrustworthy" };
  const check = parsed.data.checks[0];
  if (check === undefined || check.name !== "verify" || check.headSha !== parsed.data.headSha) {
    return { kind: "failed", reason: "ci_response_untrustworthy" };
  }
  if (check.status !== "completed") return { kind: "pending" };
  return check.conclusion === "success"
    ? { kind: "passed" }
    : { kind: "failed", reason: "ci_failed" };
}

export type MergeGateDecision =
  | { readonly kind: "allowed" }
  | { readonly kind: "blocked"; readonly reason:
      | "evidence_untrustworthy"
      | "merge_authority_missing"
      | "base_branch_advanced"
      | "checks_unsatisfied"
      | "review_unsatisfied"
      | "workflow_state_unknown"
      | "pr_not_mergeable"
      | "head_mismatch"
      | "contract_scope_expansion" };

export function evaluateMergeGate(observation: MergeGateObservationV1): MergeGateDecision {
  const value = observation;
  if (!value.defaultBranchProtected || value.adminBypassAllowed || value.bypassUsed) return { kind: "blocked", reason: "merge_authority_missing" };
  if (value.defaultBranchHeadSha !== value.lockedBaseSha || value.baseSha !== value.lockedBaseSha) return { kind: "blocked", reason: "base_branch_advanced" };
  if (!value.requiredChecksPassed) return { kind: "blocked", reason: "checks_unsatisfied" };
  if (!value.reviewsSatisfied) return { kind: "blocked", reason: "review_unsatisfied" };
  if (!value.workflowManifestSafe) return { kind: "blocked", reason: "workflow_state_unknown" };
  if (!value.pullRequestOpen || !value.pullRequestMergeable) return { kind: "blocked", reason: "pr_not_mergeable" };
  if (value.headSha !== value.expectedHeadSha || !value.machineBlockMatches) return { kind: "blocked", reason: "head_mismatch" };
  if (!value.diffWithinContract || value.forbiddenSurfaceTouched || value.capabilityExpanded || value.deploymentChanged) {
    return { kind: "blocked", reason: "contract_scope_expansion" };
  }
  return { kind: "allowed" };
}

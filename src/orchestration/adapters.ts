import type {
  EnvironmentAttestationV1,
  LockedStepContractV1,
  ModelRoutingDecisionV1,
  RoadmapV1,
  RunIntentV1,
} from "./contracts.js";
import type { RoadmapBaseReconciliationProofV1 } from "./roadmap-reconciliation.js";
import { domainSeparatedDigest } from "./canonical-json.js";
import type {
  ClaudeNegotiationRequestV1,
  ClaudeNegotiationResult,
} from "./claude-cli-negotiator.js";

export interface EvidenceEnvelope<T> {
  readonly producer: string;
  readonly observedAt: string;
  readonly evidenceDigest: string;
  readonly value: T;
}

export function createEvidenceEnvelope<T>(
  producer: string,
  observedAt: string,
  value: T,
): EvidenceEnvelope<T> {
  const evidenceDigest = domainSeparatedDigest("agent-builder/orchestration/evidence/v1", {
    producer,
    observedAt,
    value,
  });
  return { producer, observedAt, evidenceDigest, value };
}

export function verifyEvidenceEnvelope<T>(evidence: EvidenceEnvelope<T>): boolean {
  return evidence.evidenceDigest === domainSeparatedDigest("agent-builder/orchestration/evidence/v1", {
    producer: evidence.producer,
    observedAt: evidence.observedAt,
    value: evidence.value,
  });
}

export interface RunIntentVerifier {
  verify(intent: RunIntentV1): Promise<EvidenceEnvelope<{ readonly valid: boolean }>>;
}

export interface EnvironmentAttestor {
  attest(): Promise<EvidenceEnvelope<EnvironmentAttestationV1>>;
}

export interface RepositoryInspector {
  inspect(input: {
    readonly repository: RunIntentV1["repository"];
    readonly expectedBaseRevision: string;
    readonly roadmap: RoadmapV1;
  }): Promise<EvidenceEnvelope<{
    readonly originMainSha: string;
    readonly attendedLocal: boolean;
    readonly completedStepReachability: Readonly<Record<string, boolean>>;
    readonly baseReconciliationProof?: RoadmapBaseReconciliationProofV1 | null;
    readonly deploysOnMain: boolean;
    readonly defaultBranchProtected: boolean;
  }>>;
}

export interface ContractNegotiator {
  negotiate(request: ClaudeNegotiationRequestV1): Promise<ClaudeNegotiationResult>;
}

export interface ImplementationDriver {
  readonly kind: "external_attended" | "local_process";
  dispatch(input: {
    readonly idempotencyKey: string;
    readonly contract: LockedStepContractV1;
    readonly route: ModelRoutingDecisionV1;
  }): Promise<EvidenceEnvelope<{ readonly claimedHeadSha: string }>>;
}

export interface VerificationDriver {
  verify(input: {
    readonly idempotencyKey: string;
    readonly contract: LockedStepContractV1;
    readonly headSha: string;
  }): Promise<EvidenceEnvelope<{
    readonly typecheckPassed: boolean;
    readonly testsPassed: boolean;
    readonly changedPaths: readonly string[];
  }>>;
}

export interface GitFeatureWriteAdapter {
  pushFeatureBranch(input: {
    readonly idempotencyKey: string;
    readonly branch: string;
    readonly headSha: string;
  }): Promise<EvidenceEnvelope<{ readonly branch: string; readonly headSha: string }>>;
}

export interface GithubPrWriteAdapter {
  createPullRequest(input: {
    readonly idempotencyKey: string;
    readonly branch: string;
    readonly headSha: string;
    readonly baseBranch: string;
  }): Promise<EvidenceEnvelope<{ readonly number: number; readonly headSha: string; readonly open: boolean }>>;
}

export interface CiReadAdapter {
  readRequiredChecks(input: {
    readonly pullRequestNumber: number;
    readonly headSha: string;
  }): Promise<EvidenceEnvelope<{ readonly allRequiredChecksPassed: boolean }>>;
}

export interface GithubMergeAdapter {
  merge(input: {
    readonly idempotencyKey: string;
    readonly pullRequestNumber: number;
    readonly expectedHeadSha: string;
  }): Promise<EvidenceEnvelope<{ readonly mergeCommitSha: string; readonly reachableFromOriginMain: boolean }>>;
}

export interface RunAdapters {
  readonly environmentAttestor?: EnvironmentAttestor;
  readonly runIntentVerifier?: RunIntentVerifier;
  readonly repositoryInspector?: RepositoryInspector;
  readonly contractNegotiator?: ContractNegotiator;
  readonly implementationDriver?: ImplementationDriver;
  readonly verificationDriver?: VerificationDriver;
  readonly gitFeatureWrite?: GitFeatureWriteAdapter;
  readonly githubPrWrite?: GithubPrWriteAdapter;
  readonly ciRead?: CiReadAdapter;
  readonly githubMerge?: GithubMergeAdapter;
}

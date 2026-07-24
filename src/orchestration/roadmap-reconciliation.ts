import { z } from "zod";
import { domainSeparatedDigest } from "./canonical-json.js";
import {
  DigestSchema,
  GitShaSchema,
  Rfc3339InstantSchema,
  type RoadmapBaseReconciliationBindingV1,
} from "./contracts.js";

export const ROADMAP_RECONCILIATION_POLICY_VERSION = "roadmap-base-reconciliation/1" as const;
export const MAX_TRANSPARENT_META_COMMITS = 4;
export const RECONCILIATION_WORKFLOW_SAFETY_MANIFEST_DIGEST =
  "cf76aa31ea735049165136709028f69e07c82b80c1ee3eb40a0078ef61e8553d";

export const TRANSPARENT_META_ALLOWED_PATHS = Object.freeze([
  ".gitignore",
  "README.md",
  "contracts/",
  "docs/architecture/",
  "roadmap/",
  "src/orchestration/",
  "tests/orchestration/",
] as const);

export const TRANSPARENT_META_FORBIDDEN_SURFACES = Object.freeze([
  ".github/",
  "package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "pyproject.toml",
  "uv.lock",
  "secrets",
  ".env",
  ".pem",
  ".key",
  "src/assembler/",
  "src/deployment/",
  "src/gate/",
  "src/harness/",
  "src/invariants/",
  "src/runtime/",
  "src/schema/",
] as const);

const POLICY_PAYLOAD = Object.freeze({
  schemaVersion: ROADMAP_RECONCILIATION_POLICY_VERSION,
  maxTransparentMetaCommits: MAX_TRANSPARENT_META_COMMITS,
  requiredCheck: "verify",
  requiredMergeSource: "github_pull_request",
  requiredMergeMethod: "squash",
  workflowSafetyManifestDigest: RECONCILIATION_WORKFLOW_SAFETY_MANIFEST_DIGEST,
  allowedPaths: TRANSPARENT_META_ALLOWED_PATHS,
  forbiddenSurfaces: TRANSPARENT_META_FORBIDDEN_SURFACES,
  capabilityEffect: "reduce_or_preserve",
  deploymentEffect: "none",
});

export const ROADMAP_RECONCILIATION_POLICY_DIGEST = domainSeparatedDigest(
  "agent-builder/orchestration/roadmap-reconciliation-policy/v1",
  POLICY_PAYLOAD,
);

function normalizedPath(path: string): string {
  return path.replaceAll("\\", "/");
}

function touches(path: string, surface: string): boolean {
  const candidate = normalizedPath(path);
  const denied = normalizedPath(surface);
  if (denied.endsWith("/")) return candidate.startsWith(denied);
  if (denied === ".pem" || denied === ".key") return candidate.endsWith(denied);
  if (denied === ".env") return candidate === denied || candidate.startsWith(`${denied}.`);
  return candidate === denied;
}

export function isTransparentMetaPath(path: string): boolean {
  const candidate = normalizedPath(path);
  if (candidate !== path || candidate.startsWith("/") || /^[A-Za-z]:/.test(candidate)) return false;
  const parts = candidate.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) return false;
  if (parts.some((part) =>
    part === "secrets" ||
    part === ".env" ||
    part.startsWith(".env.") ||
    part.endsWith(".pem") ||
    part.endsWith(".key")
  )) return false;
  if (TRANSPARENT_META_FORBIDDEN_SURFACES.some((surface) => touches(candidate, surface))) return false;
  return TRANSPARENT_META_ALLOWED_PATHS.some((allowed) =>
    allowed.endsWith("/") ? candidate.startsWith(allowed) : candidate === allowed,
  );
}

const SortedUniqueChangedPathsSchema = z.array(z.string().min(1).max(512)).min(1).superRefine((paths, context) => {
  const sorted = [...new Set(paths)].sort();
  if (sorted.length !== paths.length || sorted.some((path, index) => path !== paths[index])) {
    context.addIssue({ code: "custom", message: "changed paths must be sorted and unique" });
  }
  for (const path of paths) {
    if (!isTransparentMetaPath(path)) {
      context.addIssue({ code: "custom", message: `changed path is not transparent governance: ${path}` });
    }
  }
});

export const TransparentMetaCommitProofV1Schema = z.object({
  schemaVersion: z.literal("transparent-meta-commit-proof/1"),
  source: z.literal("github_pull_request"),
  mergeMethod: z.literal("squash"),
  parentSha: GitShaSchema,
  mergeCommitSha: GitShaSchema,
  mergeCommitReachableFromOriginMain: z.literal(true),
  mergeCommitTreeMatchesPullRequestHead: z.literal(true),
  pullRequestNumber: z.number().int().positive(),
  pullRequestHeadSha: GitShaSchema,
  pullRequestState: z.literal("merged"),
  mergedAt: Rfc3339InstantSchema,
  requiredCheck: z.object({
    name: z.literal("verify"),
    headSha: GitShaSchema,
    conclusion: z.literal("success"),
  }).strict(),
  workflowSafetyManifestDigest: DigestSchema,
  changedPaths: SortedUniqueChangedPathsSchema,
  capabilityEffect: z.literal("reduce_or_preserve"),
  deploymentEffect: z.literal("none"),
}).strict().superRefine((proof, context) => {
  if (proof.parentSha === proof.mergeCommitSha) {
    context.addIssue({ code: "custom", path: ["parentSha"], message: "meta commit cannot parent itself" });
  }
  if (proof.requiredCheck.headSha !== proof.pullRequestHeadSha) {
    context.addIssue({ code: "custom", path: ["requiredCheck", "headSha"], message: "verify must bind the exact PR head" });
  }
  if (proof.workflowSafetyManifestDigest !== RECONCILIATION_WORKFLOW_SAFETY_MANIFEST_DIGEST) {
    context.addIssue({
      code: "custom",
      path: ["workflowSafetyManifestDigest"],
      message: "meta commit must bind the pinned workflow safety manifest",
    });
  }
});
export type TransparentMetaCommitProofV1 = z.infer<typeof TransparentMetaCommitProofV1Schema>;

const RoadmapBaseReconciliationProofPayloadFields = {
  schemaVersion: z.literal("roadmap-base-reconciliation-proof/1"),
  policyDigest: DigestSchema,
  domainBaseSha: GitShaSchema,
  observedOriginMainSha: GitShaSchema,
  commits: z.array(TransparentMetaCommitProofV1Schema).min(1).max(MAX_TRANSPARENT_META_COMMITS),
};
const RoadmapBaseReconciliationProofPayloadObjectV1Schema = z
  .object(RoadmapBaseReconciliationProofPayloadFields)
  .strict();
type RoadmapBaseReconciliationProofPayloadV1 = z.infer<
  typeof RoadmapBaseReconciliationProofPayloadObjectV1Schema
>;

function validateProofChain(
  proof: RoadmapBaseReconciliationProofPayloadV1,
  context: z.RefinementCtx,
): void {
  if (proof.policyDigest !== ROADMAP_RECONCILIATION_POLICY_DIGEST) {
    context.addIssue({ code: "custom", path: ["policyDigest"], message: "reconciliation policy digest mismatch" });
  }
  let expectedParent = proof.domainBaseSha;
  const mergeCommits = new Set<string>();
  const pullRequests = new Set<number>();
  const pullRequestHeads = new Set<string>();
  for (const [index, commit] of proof.commits.entries()) {
    if (commit.parentSha !== expectedParent) {
      context.addIssue({ code: "custom", path: ["commits", index, "parentSha"], message: "meta chain is not gap-free" });
    }
    if (mergeCommits.has(commit.mergeCommitSha) || pullRequests.has(commit.pullRequestNumber) || pullRequestHeads.has(commit.pullRequestHeadSha)) {
      context.addIssue({ code: "custom", path: ["commits", index], message: "meta chain contains duplicate provenance" });
    }
    mergeCommits.add(commit.mergeCommitSha);
    pullRequests.add(commit.pullRequestNumber);
    pullRequestHeads.add(commit.pullRequestHeadSha);
    expectedParent = commit.mergeCommitSha;
  }
  if (expectedParent !== proof.observedOriginMainSha) {
    context.addIssue({ code: "custom", path: ["observedOriginMainSha"], message: "meta chain does not end at observed origin/main" });
  }
}

const RoadmapBaseReconciliationProofPayloadV1Schema =
  RoadmapBaseReconciliationProofPayloadObjectV1Schema.superRefine(validateProofChain);

export const RoadmapBaseReconciliationProofV1Schema = z
  .object({ ...RoadmapBaseReconciliationProofPayloadFields, proofDigest: DigestSchema })
  .strict()
  .superRefine(validateProofChain);
export type RoadmapBaseReconciliationProofV1 = z.infer<typeof RoadmapBaseReconciliationProofV1Schema>;
export type RoadmapBaseReconciliationProofV1Input = z.input<typeof RoadmapBaseReconciliationProofPayloadV1Schema>;

export function createRoadmapBaseReconciliationProofV1(
  input: RoadmapBaseReconciliationProofV1Input,
): RoadmapBaseReconciliationProofV1 {
  const payload = RoadmapBaseReconciliationProofPayloadV1Schema.parse(input);
  return RoadmapBaseReconciliationProofV1Schema.parse({
    ...payload,
    proofDigest: domainSeparatedDigest("agent-builder/orchestration/roadmap-base-reconciliation-proof/v1", payload),
  });
}

export function verifyRoadmapBaseReconciliationProofV1(
  proof: RoadmapBaseReconciliationProofV1,
): boolean {
  const parsed = RoadmapBaseReconciliationProofV1Schema.safeParse(proof);
  if (!parsed.success) return false;
  const { proofDigest, ...payload } = parsed.data;
  return proofDigest === domainSeparatedDigest(
    "agent-builder/orchestration/roadmap-base-reconciliation-proof/v1",
    payload,
  );
}

export function reconciliationBinding(
  proof: RoadmapBaseReconciliationProofV1,
): RoadmapBaseReconciliationBindingV1 {
  if (!verifyRoadmapBaseReconciliationProofV1(proof)) {
    throw new TypeError("roadmap reconciliation proof is malformed or untrustworthy");
  }
  return {
    schemaVersion: "roadmap-base-reconciliation-binding/1",
    policyDigest: proof.policyDigest,
    domainBaseSha: proof.domainBaseSha,
    observedOriginMainSha: proof.observedOriginMainSha,
    proofDigest: proof.proofDigest,
  };
}

import {
  RoadmapV1Schema,
  type RoadmapItemV1,
  type RoadmapV1,
  type RunIntentV1,
} from "./contracts.js";
import {
  ROADMAP_RECONCILIATION_POLICY_VERSION,
  reconciliationBinding,
  verifyRoadmapBaseReconciliationProofV1,
  type RoadmapBaseReconciliationProofV1,
} from "./roadmap-reconciliation.js";

export const GLOBAL_FORBIDDEN_SURFACES = Object.freeze([
  ".github/",
  "package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "pyproject.toml",
  "uv.lock",
  ".env",
  ".env.",
  ".pem",
  ".key",
  "LICENSE",
  "SECURITY",
  "CODEOWNERS",
  ".gitignore",
  "src/orchestration/",
] as const);

export interface CommitReachabilityProof {
  readonly commitSha: string;
  readonly reachableFromOriginMain: boolean;
}

export type RoadmapSelection =
  | {
      readonly kind: "selected";
      readonly item: RoadmapItemV1;
      readonly baseReconciliation: ReturnType<typeof reconciliationBinding> | null;
    }
  | { readonly kind: "completed" }
  | {
      readonly kind: "stopped";
      readonly reason:
        | "roadmap_history_unverified"
        | "roadmap_base_reconciliation_unverified"
        | "roadmap_zero_eligible"
        | "roadmap_multiple_eligible";
      readonly blockers: readonly string[];
    };

function normalizedPath(path: string): string {
  return path.replaceAll("\\", "/");
}

export function pathTouchesSurface(path: string, surface: string): boolean {
  const candidate = normalizedPath(path);
  const denied = normalizedPath(surface);
  if (denied.endsWith("/")) {
    return candidate.startsWith(denied);
  }
  if (denied === ".env.") {
    return candidate.startsWith(".env.");
  }
  if (denied === ".pem" || denied === ".key") {
    return candidate.endsWith(denied);
  }
  if (denied === "LICENSE" || denied === "SECURITY") {
    return candidate === denied || candidate.startsWith(`${denied}.`);
  }
  return candidate === denied;
}

export function isPathAllowed(path: string, allowedPaths: readonly string[]): boolean {
  const candidate = normalizedPath(path);
  return allowedPaths.some((allowedPath) => {
    const allowed = normalizedPath(allowedPath);
    return allowed.endsWith("/") ? candidate.startsWith(allowed) : candidate === allowed;
  });
}

export function validateActualDiff(
  paths: readonly string[],
  allowedPaths: readonly string[],
  itemForbiddenSurfaces: readonly string[] = [],
): { readonly valid: true } | { readonly valid: false; readonly reason: "governance_touch" | "contract_scope_expansion"; readonly path: string } {
  const forbidden = [...GLOBAL_FORBIDDEN_SURFACES, ...itemForbiddenSurfaces];
  for (const path of paths) {
    if (forbidden.some((surface) => pathTouchesSurface(path, surface))) {
      return { valid: false, reason: "governance_touch", path };
    }
    if (!isPathAllowed(path, allowedPaths)) {
      return { valid: false, reason: "contract_scope_expansion", path };
    }
  }
  return { valid: true };
}

export function selectNextRoadmapItem(
  roadmapInput: RoadmapV1,
  intent: RunIntentV1,
  verifiedOriginMainSha: string,
  ancestryProofs: readonly CommitReachabilityProof[],
  baseReconciliationProof: RoadmapBaseReconciliationProofV1 | null = null,
): RoadmapSelection {
  const roadmap = RoadmapV1Schema.parse(roadmapInput);
  const proofBySha = new Map(ancestryProofs.map((proof) => [proof.commitSha, proof.reachableFromOriginMain]));
  const duplicateIds = roadmap.items.filter(
    (item, index) => roadmap.items.findIndex((candidate) => candidate.stepId === item.stepId) !== index,
  );
  if (duplicateIds.length > 0) {
    return { kind: "stopped", reason: "roadmap_history_unverified", blockers: duplicateIds.map((item) => item.stepId) };
  }

  const completed = roadmap.items.filter((item) => item.mergeCommitSha !== null);
  const unverifiedHistory = completed.filter(
    (item) => item.mergeCommitSha === null || proofBySha.get(item.mergeCommitSha) !== true,
  );
  if (unverifiedHistory.length > 0) {
    return {
      kind: "stopped",
      reason: "roadmap_history_unverified",
      blockers: unverifiedHistory.map((item) => item.stepId),
    };
  }

  const incomplete = roadmap.items.filter((item) => item.mergeCommitSha === null);
  if (incomplete.length === 0) {
    return { kind: "completed" };
  }
  const completedById = new Map(completed.map((item) => [item.stepId, item]));
  const reconciledBaseIsValid = (item: RoadmapItemV1): boolean =>
    roadmap.reconciliationPolicyVersion === ROADMAP_RECONCILIATION_POLICY_VERSION &&
    baseReconciliationProof !== null &&
    verifyRoadmapBaseReconciliationProofV1(baseReconciliationProof) &&
    baseReconciliationProof.domainBaseSha === item.expectedBaseMergeSha &&
    baseReconciliationProof.observedOriginMainSha === verifiedOriginMainSha;
  const eligible = incomplete.filter((item) => {
    const dependenciesVerified = item.dependencies.every((dependencyId) => {
      const dependency = completedById.get(dependencyId);
      return dependency?.mergeCommitSha !== null &&
        dependency?.mergeCommitSha !== undefined &&
        proofBySha.get(dependency.mergeCommitSha) === true;
    });
    const surfaces = [...GLOBAL_FORBIDDEN_SURFACES, ...item.forbiddenSurfaces];
    const declaredScopeSafe = item.allowedPaths.every(
      (path) => !surfaces.some((surface) => pathTouchesSurface(path, surface)),
    );
    return dependenciesVerified &&
      (item.expectedBaseMergeSha === verifiedOriginMainSha || reconciledBaseIsValid(item)) &&
      intent.allowedChangeClasses.includes(item.changeClass) &&
      item.capabilityEffect === "reduce_or_preserve" &&
      item.deploymentEffect === "none" &&
      !item.requiresHumanDecision &&
      declaredScopeSafe;
  });

  if (eligible.length === 1) {
    const item = eligible[0]!;
    return {
      kind: "selected",
      item,
      baseReconciliation: item.expectedBaseMergeSha === verifiedOriginMainSha
        ? null
        : reconciliationBinding(baseReconciliationProof!),
    };
  }
  if (eligible.length > 1) {
    return {
      kind: "stopped",
      reason: "roadmap_multiple_eligible",
      blockers: eligible.map((item) => item.stepId),
    };
  }
  if (
    incomplete.some((item) => item.expectedBaseMergeSha !== verifiedOriginMainSha) &&
    !incomplete.some(reconciledBaseIsValid)
  ) {
    return {
      kind: "stopped",
      reason: "roadmap_base_reconciliation_unverified",
      blockers: incomplete.map((item) => item.stepId),
    };
  }
  return {
    kind: "stopped",
    reason: "roadmap_zero_eligible",
    blockers: incomplete.map((item) => item.stepId),
  };
}

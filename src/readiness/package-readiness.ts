import { evaluateGuidedBriefingReadiness } from "../briefing/guided-briefing.js";
import { requiredPackageArtifactsPresent, type AgentPackage } from "../package/agent-package.js";

export type DeliveryReadinessReason =
  | "briefing_incomplete"
  | "package_artifacts_incomplete"
  | "package_subject_mismatch"
  | "security_evidence_missing"
  | "security_evidence_failed";

export interface BuilderSecurityEvidence {
  readonly commitSha: string;
  readonly ciRunUrl: string;
  readonly baselinePassed: boolean;
  readonly dependencyAuditPassed: boolean;
}

export interface DeliveryReadinessInput {
  readonly briefing: unknown;
  readonly package: AgentPackage;
  readonly security: BuilderSecurityEvidence | undefined;
}

export type DeliveryReadinessResult =
  | { readonly ready: true; readonly package: AgentPackage; readonly evidence: BuilderSecurityEvidence }
  | { readonly ready: false; readonly reasons: readonly DeliveryReadinessReason[] };

/**
 * Final Builder-side delivery gate. It grants no deployment authority: a true
 * result only means this exact in-memory ZIP has the required Builder evidence.
 */
export function evaluateDeliveryReadiness(input: DeliveryReadinessInput): DeliveryReadinessResult {
  const reasons: DeliveryReadinessReason[] = [];
  if (!evaluateGuidedBriefingReadiness(input.briefing).ready) reasons.push("briefing_incomplete");
  if (!requiredPackageArtifactsPresent(input.package.manifest)) reasons.push("package_artifacts_incomplete");
  if (input.package.manifest.specId === "" || input.package.manifest.version === "" || input.package.sha256.length !== 64) reasons.push("package_subject_mismatch");
  if (input.security === undefined) reasons.push("security_evidence_missing");
  else if (!input.security.baselinePassed || !input.security.dependencyAuditPassed || !/^[0-9a-f]{40}$/i.test(input.security.commitSha) || !/^https:\/\//.test(input.security.ciRunUrl)) reasons.push("security_evidence_failed");
  return reasons.length === 0 && input.security !== undefined ? { ready: true, package: input.package, evidence: input.security } : { ready: false, reasons };
}

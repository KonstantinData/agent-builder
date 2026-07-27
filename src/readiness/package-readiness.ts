import { evaluateGuidedBriefingReadiness } from "../briefing/guided-briefing.js";
import { requiredPackageArtifactsPresent, verifyAgentPackageBytes, type AgentPackage } from "../package/agent-package.js";
import { validateTemplateAdaptation } from "../template/template-governance.js";
import { AgentSpecApprovalSchema } from "../schema/approval-artifact.js";
import { AgentSpecContentSchema } from "../schema/agent-spec-content.js";
import { EvaluationOutcomeSchema } from "../schema/evaluation-outcome.js";
import { checkEvaluationOutcome } from "../harness/evaluation-check.js";
import { createHash } from "node:crypto";

export type DeliveryReadinessReason =
  | "briefing_incomplete"
  | "package_artifacts_incomplete"
  | "package_subject_mismatch"
  | "security_evidence_missing"
  | "security_evidence_failed"
  | "briefing_adaptation_unbound"
  | "template_adaptation_invalid"
  | "approval_evaluation_invalid"
  | "package_integrity_invalid";

export interface BuilderSecurityEvidence {
  readonly commitSha: string;
  readonly ciRunUrl: string;
  readonly baselinePassed: boolean;
  readonly dependencyAuditPassed: boolean;
}

export interface DeliveryReadinessInput {
  readonly briefing: unknown;
  readonly briefingBinding: { readonly briefingId: string; readonly adaptationId: string; readonly draftId: string };
  readonly template: unknown;
  readonly adaptation: unknown;
  readonly spec: unknown;
  readonly approval: unknown;
  readonly evaluation: unknown;
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
  const briefing = evaluateGuidedBriefingReadiness(input.briefing);
  if (!briefing.ready) reasons.push("briefing_incomplete");
  else if (briefing.briefing.briefingId !== input.briefingBinding.briefingId) reasons.push("briefing_adaptation_unbound");
  const adaptation = validateTemplateAdaptation(input.template, input.adaptation);
  if (!adaptation.success) reasons.push("template_adaptation_invalid");
  const spec = AgentSpecContentSchema.safeParse(input.spec);
  const approval = AgentSpecApprovalSchema.safeParse(input.approval);
  const evaluation = EvaluationOutcomeSchema.safeParse(input.evaluation);
  if (!spec.success || !approval.success || !evaluation.success || approval.success && evaluation.success && spec.success && (
    approval.data.decision !== "approved" || approval.data.specId !== spec.data.specId || approval.data.version !== spec.data.version || approval.data.contentHash !== spec.data.contentHash ||
    evaluation.data.subject.specId !== spec.data.specId || evaluation.data.subject.version !== spec.data.version || evaluation.data.subject.contentHash !== spec.data.contentHash ||
    checkEvaluationOutcome(spec.data, evaluation.data).length > 0 || approval.data.evidence.policyOutcome !== "approved_pending_gate" || approval.data.evidence.evaluationRef?.evidenceId !== evaluation.data.evidenceId ||
    !adaptation.success || adaptation.value.adaptationId !== input.briefingBinding.adaptationId || adaptation.value.adaptedDraft.draftId !== input.briefingBinding.draftId || adaptation.value.adaptedDraft.specId !== spec.data.specId
  )) reasons.push("approval_evaluation_invalid");
  const verifiedPackage = verifyAgentPackageBytes(input.package.bytes);
  if (!verifiedPackage.success || !requiredPackageArtifactsPresent(input.package.manifest) || !requiredPackageArtifactsPresent(verifiedPackage.success ? verifiedPackage.manifest : input.package.manifest)) reasons.push("package_artifacts_incomplete");
  if (!spec.success || input.package.manifest.specId !== spec.data.specId || input.package.manifest.version !== spec.data.version || input.package.manifest.contentHash !== spec.data.contentHash || input.package.fileName !== `${input.package.manifest.specId}-${input.package.manifest.version}.zip`) reasons.push("package_subject_mismatch");
  if (!verifiedPackage.success || createHash("sha256").update(input.package.bytes).digest("hex") !== input.package.sha256 || JSON.stringify(verifiedPackage.success ? verifiedPackage.manifest : undefined) !== JSON.stringify(input.package.manifest)) reasons.push("package_integrity_invalid");
  if (input.security === undefined) reasons.push("security_evidence_missing");
  else if (!input.security.baselinePassed || !input.security.dependencyAuditPassed || !/^[0-9a-f]{40}$/i.test(input.security.commitSha) || !/^https:\/\//.test(input.security.ciRunUrl)) reasons.push("security_evidence_failed");
  return reasons.length === 0 && input.security !== undefined ? { ready: true, package: input.package, evidence: input.security } : { ready: false, reasons };
}

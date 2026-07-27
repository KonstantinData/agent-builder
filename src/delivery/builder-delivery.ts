import { assembleSpec } from "../assembler/assemble-spec.js";
import type { AssemblyContext } from "../assembler/assembly-types.js";
import {
  evaluateCompletedGuidedBriefingFlowReadiness,
  type FlowSigner,
} from "../briefing/guided-briefing.js";
import { runDeploymentGate } from "../gate/run-deployment-gate.js";
import type { TrustedDecisionContext } from "../gate/gate-types.js";
import { evaluatePolicy } from "../harness/evaluate-policy.js";
import type { PolicyContext } from "../harness/harness-types.js";
import { buildAgentPackage, type AgentPackage } from "../package/agent-package.js";
import {
  evaluateDeliveryReadiness,
  type BuilderSecurityEvidence,
  type DeliveryReadinessReason,
} from "../readiness/package-readiness.js";
import type { AgentSpecRuntimeMetadata } from "../schema/agent-spec-runtime-metadata.js";
import { AgentSpecContentSchema } from "../schema/agent-spec-content.js";
import { EvaluationOutcomeSchema } from "../schema/evaluation-outcome.js";
import { validateTemplateAdaptation } from "../template/template-governance.js";

export interface BuilderDeliveryProviders {
  /** Evaluates only the immutable Spec assembled by this composition. */
  readonly evaluate: (spec: Parameters<typeof buildAgentPackage>[0]["spec"]) => unknown;
}

export interface BuilderDeliveryCompositionInput {
  readonly briefing: unknown;
  readonly briefingSigner: FlowSigner;
  readonly template: unknown;
  readonly adaptation: unknown;
  readonly assemblyContext: AssemblyContext;
  readonly policyContext: PolicyContext;
  readonly gateMetadata: AgentSpecRuntimeMetadata;
  /** Already-attested human decision context; the Builder cannot create it. */
  readonly trustedDecision: TrustedDecisionContext;
  readonly providers: BuilderDeliveryProviders;
  readonly security: BuilderSecurityEvidence | undefined;
}

export type BuilderDeliveryCompositionResult =
  | { readonly ready: true; readonly package: AgentPackage; readonly evidence: BuilderSecurityEvidence }
  | {
      readonly ready: false;
      readonly stage: "briefing" | "adaptation" | "assembly" | "evaluation" | "policy" | "approval" | "package" | "readiness";
      readonly reasons: readonly string[];
    };

/**
 * Executes the only Builder-side delivery composition. It never accepts a
 * caller-supplied Spec, policy verdict, approval, package, manifest, or ZIP
 * bytes. Every later stage receives only an artifact retained by this run.
 * The result is preparation evidence, never deployment authority.
 */
export function composeBuilderDelivery(input: BuilderDeliveryCompositionInput): BuilderDeliveryCompositionResult {
  const briefing = evaluateCompletedGuidedBriefingFlowReadiness(input.briefing, input.briefingSigner);
  if (!briefing.ready) return { ready: false, stage: "briefing", reasons: ["briefing_incomplete"] };

  const adaptation = validateTemplateAdaptation(input.template, input.adaptation);
  if (!adaptation.success) return { ready: false, stage: "adaptation", reasons: [adaptation.reason] };

  const assembly = assembleSpec(adaptation.value.adaptedDraft, input.assemblyContext);
  if (!assembly.success) {
    return { ready: false, stage: "assembly", reasons: assembly.reasons.map((reason) => reason.type) };
  }

  // The evaluator receives a detached value. Policy, gate, packaging, and
  // readiness retain the assembler's original immutable candidate, so an
  // evaluator cannot widen the candidate it is supposed to measure.
  let evaluationCandidate: unknown;
  try {
    evaluationCandidate = input.providers.evaluate(
      AgentSpecContentSchema.parse(JSON.parse(JSON.stringify(assembly.content))),
    );
  } catch {
    return { ready: false, stage: "evaluation", reasons: ["evaluation_provider_failed"] };
  }
  const evaluation = EvaluationOutcomeSchema.safeParse(evaluationCandidate);
  if (!evaluation.success) return { ready: false, stage: "evaluation", reasons: ["evaluation_schema_invalid"] };

  const policy = evaluatePolicy(assembly.content, input.policyContext, evaluation.data);
  if (policy.outcome !== "approved_pending_gate" || policy.evaluation === undefined) {
    return {
      ready: false,
      stage: "policy",
      reasons: policy.outcome === "rejected" ? policy.reasons.map((reason) => reason.type) : [policy.outcome],
    };
  }

  const gate = runDeploymentGate(assembly.content, input.gateMetadata, policy, input.trustedDecision);
  if (gate.outcome !== "approved") return { ready: false, stage: "approval", reasons: [gate.reason.type] };

  let packageValue: AgentPackage;
  try {
    packageValue = buildAgentPackage({ spec: assembly.content, evaluation: policy.evaluation, approval: gate.approval });
  } catch {
    return { ready: false, stage: "package", reasons: ["package_evidence_unbound"] };
  }

  const readiness = evaluateDeliveryReadiness({
    briefing: input.briefing,
    briefingSigner: input.briefingSigner,
    briefingBinding: { briefingId: briefing.briefing.briefingId, adaptationId: adaptation.value.adaptationId, draftId: adaptation.value.adaptedDraft.draftId },
    template: input.template,
    adaptation: input.adaptation,
    spec: assembly.content,
    evaluation: policy.evaluation,
    approval: gate.approval,
    package: packageValue,
    security: input.security,
  });
  if (!readiness.ready) {
    return { ready: false, stage: "readiness", reasons: readiness.reasons as readonly DeliveryReadinessReason[] };
  }
  return readiness;
}

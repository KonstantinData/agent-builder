import { describe, expect, it, vi } from "vitest";
import { answerGuidedBriefing, completeGuidedBriefing, startGuidedBriefing } from "../../src/briefing/guided-briefing.js";
import { composeBuilderDelivery } from "../../src/delivery/builder-delivery.js";
import type { BuilderDeliveryCompositionInput } from "../../src/delivery/builder-delivery.js";
import type { AgentTemplate } from "../../src/schema/agent-template.js";
import { computeTemplateContentHash } from "../../src/template/template-governance.js";
import { computeContentHash } from "../../src/assembler/content-hash.js";
import { SpecIdSchema } from "../../src/schema/common.js";
import { domainSales } from "../fixtures/specs.js";
import { makeTestPrincipal } from "../support/approval-principal.js";

const topics = ["workflow_and_outcome", "required_information", "allowed_systems", "decision_boundaries", "output_and_tone", "tests_and_acceptance"] as const;
const signer = { sign: (digest: string) => `trusted:${digest}`, verify: (digest: string, signature: string) => signature === `trusted:${digest}` };
const security = { commitSha: "a".repeat(40), ciRunUrl: "https://github.com/example/run/1", baselinePassed: true, dependencyAuditPassed: true };
const deliverySpecId = SpecIdSchema.parse("spec-delivery-1");
const templateWithoutHash: Omit<AgentTemplate, "contentHash"> = { templateId: "delivery-template", templateVersion: "1.0.0", intent: { name: "Delivery Agent", objective: "Create a safely evidenced delivery package", promptTemplate: "Produce a safe delivery plan.", declaredTools: [{ toolId: "crm.enrich", scope: "tenant:acme:crm", params: {} }], declaredRoles: ["crm-enrichment"], resourceLimits: { costCeiling: 5, maxIterations: 5, timeoutMs: 1000 }, evalRequirements: { suiteRef: "suite-delivery-v1", passThreshold: 0.9 }, memoryScope: "tenant:acme:crm", trustDomainId: domainSales.domainId, requestedAgentCalls: [] } };
const template = { ...templateWithoutHash, contentHash: computeTemplateContentHash(templateWithoutHash) };
const adaptation = { adaptationId: "adaptation-delivery-1", template: { templateId: template.templateId, templateVersion: template.templateVersion }, templateContentHash: template.contentHash, adaptedDraft: { ...template.intent, draftId: "draft-delivery-1", specId: deliverySpecId }, sanitizedAdaptationSummary: "Safe one-off adaptation." };

function completedBriefing() {
  let flow = startGuidedBriefing({ briefingId: "briefing-delivery-1", roughRequest: "Build a delivery agent for safe evidence.", signer, questionProvider: { questionsFor: ({ missingTopics }) => missingTopics.map((topic, index) => ({ question: { questionId: `q-${index}`, topic, prompt: `Question ${index}`, rationale: "delivery agent evidence" }, contextNeed: "delivery agent evidence" })) } });
  for (const topic of topics) flow = answerGuidedBriefing(flow, { questionId: `q-${topics.indexOf(topic)}`, topic, sanitizedSummary: "Generic requirement.", sourceClassification: "generic_requirement" }, signer);
  return completeGuidedBriefing(flow, { planFor: ({ flowDigest }) => ({ planSummary: "Completed delivery plan.", flowDigest }) }, signer);
}

function input(overrides: Partial<BuilderDeliveryCompositionInput> = {}): BuilderDeliveryCompositionInput {
  const base: BuilderDeliveryCompositionInput = { briefing: completedBriefing(), briefingSigner: signer, template, adaptation, assemblyContext: { approvedSpecs: [], trustDomains: [domainSales] }, policyContext: { approvedSpecs: [], trustDomains: [domainSales], forbiddenToolCombinations: [], evaluationReferenceTime: "2026-07-27T12:30:00+02:00" }, gateMetadata: { specId: adaptation.adaptedDraft.specId, version: "1", state: "in_review", stateHistory: [{ state: "draft", actor: "agent-builder", timestamp: "2026-07-27T11:00:00+02:00", reason: "Created." }, { state: "in_review", actor: "agent-builder", timestamp: "2026-07-27T11:30:00+02:00", reason: "Ready for review." }], requestor: "agent-builder" }, trustedDecision: { principal: makeTestPrincipal("konstantin"), decidedAt: "2026-07-27T12:01:00+02:00", artifactId: "approval-delivery-1" }, security, providers: { evaluate: (spec: any) => ({ evidenceId: "evaluation-delivery-1", subject: { specId: spec.specId, version: spec.version, contentHash: spec.contentHash }, suiteRef: spec.evalRequirements.suiteRef, score: 0.95, completedAt: "2026-07-27T12:00:00+02:00", environment: "disposable_mock", usedProductionData: false, usedProductionCredentials: false }) } };
  return { ...base, ...overrides };
}

describe("Builder delivery composition", () => {
  it("composes briefing, adaptation, assembly, policy, approval, package, and readiness into one ready ZIP", () => {
    expect(composeBuilderDelivery(input())).toMatchObject({ ready: true, package: { fileName: "spec-delivery-1-1.zip" } });
  });

  it("fails closed when an evaluator attempts to substitute evidence for a different spec", () => {
    const result = composeBuilderDelivery(input({ providers: { evaluate: (spec: any) => ({ evidenceId: "foreign", subject: { specId: "spec-foreign", version: spec.version, contentHash: spec.contentHash }, suiteRef: spec.evalRequirements.suiteRef, score: 0.95, completedAt: "2026-07-27T12:00:00+02:00", environment: "disposable_mock", usedProductionData: false, usedProductionCredentials: false }) } }));
    expect(result).toEqual({ ready: false, stage: "policy", reasons: ["evaluation_subject_mismatch"] });
  });

  it("fails closed when the trusted gate context attempts self approval", () => {
    const result = composeBuilderDelivery(input({ trustedDecision: { principal: makeTestPrincipal("agent-builder"), decidedAt: "2026-07-27T12:01:00+02:00", artifactId: "approval-self" } }));
    expect(result).toEqual({ ready: false, stage: "approval", reasons: ["self_approval_forbidden"] });
  });

  it("keeps the assembled candidate unchanged when the evaluator mutates its argument", () => {
    const result = composeBuilderDelivery(input({ providers: { evaluate: (spec: any) => { spec.objective = "mutated objective"; const { contentHash: _previousHash, ...hashable } = spec; spec.contentHash = computeContentHash(hashable); return { evidenceId: "mutated", subject: { specId: spec.specId, version: spec.version, contentHash: spec.contentHash }, suiteRef: spec.evalRequirements.suiteRef, score: 0.95, completedAt: "2026-07-27T12:00:00+02:00", environment: "disposable_mock", usedProductionData: false, usedProductionCredentials: false }; } } }));
    expect(result).toEqual({ ready: false, stage: "policy", reasons: ["evaluation_subject_mismatch"] });
  });

  it("turns evaluator exceptions into a fail-closed stage result", () => {
    expect(composeBuilderDelivery(input({ providers: { evaluate: () => { throw new Error("provider unavailable"); } } }))).toEqual({ ready: false, stage: "evaluation", reasons: ["evaluation_provider_failed"] });
  });

  it("blocks before evaluation when the immutable adaptation cannot be assembled", () => {
    const evaluate = vi.fn(input().providers.evaluate);
    expect(composeBuilderDelivery(input({ assemblyContext: { approvedSpecs: [], trustDomains: [] }, providers: { evaluate } }))).toMatchObject({ ready: false, stage: "assembly", reasons: ["trust_domain_not_found"] });
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("stops before assembly and evaluation when the signed briefing is substituted", () => {
    const evaluate = vi.fn(input().providers.evaluate);
    const result = composeBuilderDelivery(input({ briefing: { ...completedBriefing(), signature: "forged" }, providers: { evaluate } }));
    expect(result).toEqual({ ready: false, stage: "briefing", reasons: ["briefing_incomplete"] });
    expect(evaluate).not.toHaveBeenCalled();
  });
});

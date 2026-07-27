import { describe, expect, it } from "vitest";
import { buildAgentPackage, requiredPackageArtifactsPresent } from "../../src/package/agent-package.js";
import { evaluationFor, validAgentSpecContent } from "../fixtures/specs.js";

function approved(spec = validAgentSpecContent) { return { type: "agent_spec", artifactId: "approval-package-001", requestedBy: "agent-builder", decision: "approved", decidedBy: "konstantin", decidedAt: "2026-07-27T08:00:00+02:00", specId: spec.specId, version: spec.version, contentHash: spec.contentHash, evidence: { policyOutcome: "approved_pending_gate", delta: "initial", evaluationRef: evaluationFor(spec) } }; }
describe("versioned agent package", () => {
  it("creates deterministic ZIP bytes with required evidence artifacts", () => { const input = { spec: validAgentSpecContent, approval: approved(), evaluation: evaluationFor(validAgentSpecContent) }; const first = buildAgentPackage(input); expect(first.fileName).toBe("spec-crm-enricher-1.0.0.zip"); expect(first.bytes.slice(0, 4)).toEqual(Uint8Array.of(0x50, 0x4b, 0x03, 0x04)); expect(first.sha256).toBe(buildAgentPackage(input).sha256); expect(requiredPackageArtifactsPresent(first.manifest)).toBe(true); });
  it("rejects foreign evidence and credential markers", () => { const evaluation = evaluationFor(validAgentSpecContent); expect(() => buildAgentPackage({ spec: validAgentSpecContent, approval: { ...approved(), contentHash: "other" }, evaluation })).toThrow("approval does not bind"); const unsafe = { ...validAgentSpecContent, promptTemplate: "Use password=fixture." }; expect(() => buildAgentPackage({ spec: unsafe, approval: approved(unsafe), evaluation: evaluationFor(unsafe) })).toThrow("prohibited"); });
});

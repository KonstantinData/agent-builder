import { describe, expect, it } from "vitest";
import { AgentSpecApprovalSchema } from "../../src/schema/approval-artifact.js";
import type { RuntimeBindingArtifact } from "../../src/schema/runtime-binding.js";
import {
  AgentSpecTraceabilityRecordSchema,
  computeAgentSpecTraceabilityDigest,
  createAgentSpecTraceabilityRecord,
} from "../../src/traceability/agent-spec-traceability.js";
import { evaluationFor, validAgentSpecContent } from "../fixtures/specs.js";

const approvalArtifact = AgentSpecApprovalSchema.parse({
  type: "agent_spec",
  artifactId: "approval-crm-enricher-001",
  requestedBy: "agent-builder",
  decision: "approved",
  decidedBy: "konstantin",
  decidedAt: "2026-07-23T12:00:00Z",
  specId: validAgentSpecContent.specId,
  version: validAgentSpecContent.version,
  contentHash: validAgentSpecContent.contentHash,
  evidence: {
    policyOutcome: "approved_pending_gate",
    delta: "initial",
    evaluationRef: evaluationFor(validAgentSpecContent),
  },
});

const runtimeBinding: RuntimeBindingArtifact = {
  bindingId: "binding-crm-enricher-001",
  specId: validAgentSpecContent.specId,
  version: validAgentSpecContent.version,
  contentHash: validAgentSpecContent.contentHash,
  approvalArtifactId: approvalArtifact.artifactId,
  runtimeInstanceId: "runtime-crm-enricher-001",
  deployedAt: "2026-07-23T12:30:00Z",
  ttl: 3600,
};

function validRecord() {
  return createAgentSpecTraceabilityRecord({
    recordedAt: "2026-07-23T12:31:00Z",
    spec: validAgentSpecContent,
    evaluationEvidence: evaluationFor(validAgentSpecContent),
    approvalArtifact,
    runtimeBinding,
    notionDocumentationReference: "notion://agent-docs/crm-enricher/v1",
  });
}

function rehashedRecord(replacement: Record<string, unknown>) {
  const { recordDigest: _previousDigest, ...unsignedRecord } = {
    ...validRecord(),
    ...replacement,
  };
  return {
    ...unsignedRecord,
    recordDigest: computeAgentSpecTraceabilityDigest(unsignedRecord),
  };
}

describe("AgentSpecTraceabilityRecord", () => {
  it("creates a deterministic, candidate-bound documentation sidecar", () => {
    const record = validRecord();
    const reorderedInput = {
      runtimeBinding: record.runtimeBinding,
      approvalArtifact: record.approvalArtifact,
      notionDocumentationReference: record.notionDocumentationReference,
      recordedAt: record.recordedAt,
      evaluationEvidence: record.evaluationEvidence,
      spec: record.spec,
      schemaVersion: record.schemaVersion,
    } as const;

    expect(record.recordDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(computeAgentSpecTraceabilityDigest(reorderedInput)).toBe(record.recordDigest);
    expect(AgentSpecTraceabilityRecordSchema.parse(record)).toEqual(record);
  });

  it.each([
    ["foreign evaluation subject", { evaluationEvidence: evaluationFor(validAgentSpecContent, { subject: { specId: "spec-foreign" as typeof validAgentSpecContent.specId, version: validAgentSpecContent.version, contentHash: validAgentSpecContent.contentHash } }) }],
    ["foreign approval subject", { approvalArtifact: { ...approvalArtifact, contentHash: "a".repeat(64) } }],
    ["foreign binding subject", { runtimeBinding: { ...runtimeBinding, version: "foreign" } }],
    ["wrong approval lineage", { runtimeBinding: { ...runtimeBinding, approvalArtifactId: "approval-other" } }],
    ["wrong evaluation evidence", { evaluationEvidence: evaluationFor(validAgentSpecContent, { evidenceId: "evidence-replayed" }) }],
    ["rejected approval", { approvalArtifact: AgentSpecApprovalSchema.parse({ ...approvalArtifact, decision: "rejected", evidence: { policyOutcome: "rejected", rejectionReasonCodes: ["evaluation_below_threshold"] } }) }],
  ] as const)("rejects %s", (_name, replacement) => {
    expect(AgentSpecTraceabilityRecordSchema.safeParse(rehashedRecord(replacement)).success).toBe(false);
  });

  it("rejects non-chronological and altered evidence rather than normalizing it", () => {
    const record = validRecord();
    expect(
      AgentSpecTraceabilityRecordSchema.safeParse({
        ...rehashedRecord({
          recordedAt: "2026-07-23T11:59:00Z",
        }),
      }).success,
    ).toBe(false);
    expect(
      AgentSpecTraceabilityRecordSchema.safeParse({
        ...record,
        notionDocumentationReference: "notion://agent-docs/tampered",
      }).success,
    ).toBe(false);
    expect(
      AgentSpecTraceabilityRecordSchema.safeParse(
        rehashedRecord({ spec: { ...validAgentSpecContent, objective: "tampered after approval" } }),
      ).success,
    ).toBe(false);
  });

  it("treats the Notion reference as opaque documentation, never as authority", () => {
    const record = validRecord();
    expect(record.notionDocumentationReference).toBe("notion://agent-docs/crm-enricher/v1");
    expect("notionDocumentationReference" in record.approvalArtifact).toBe(false);
    expect("notionDocumentationReference" in record.runtimeBinding).toBe(false);
  });
});

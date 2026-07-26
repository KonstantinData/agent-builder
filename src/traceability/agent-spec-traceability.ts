import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalize, contentHashMatches } from "../assembler/content-hash.js";
import { AgentSpecContentSchema, type AgentSpecContent } from "../schema/agent-spec-content.js";
import { AgentSpecApprovalSchema, type AgentSpecApproval } from "../schema/approval-artifact.js";
import { EvaluationOutcomeSchema, type EvaluationOutcome } from "../schema/evaluation-outcome.js";
import { Rfc3339WithOffsetSchema } from "../schema/runtime-binding-validity.js";
import { RuntimeBindingArtifactSchema, type RuntimeBindingArtifact } from "../schema/runtime-binding.js";

const RecordDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);

/**
 * A documentation-only pointer. The Builder neither fetches nor trusts Notion
 * through this field: it is an opaque human-facing cross-reference, not evidence.
 */
export const OpaqueNotionDocumentationReferenceSchema = z.string().min(1).max(2_048);
export type OpaqueNotionDocumentationReference = z.infer<
  typeof OpaqueNotionDocumentationReferenceSchema
>;

export const AgentSpecTraceabilityRecordSchema = z
  .object({
    schemaVersion: z.literal("agent-spec-traceability/1"),
    recordedAt: Rfc3339WithOffsetSchema,
    spec: AgentSpecContentSchema,
    evaluationEvidence: EvaluationOutcomeSchema,
    approvalArtifact: AgentSpecApprovalSchema,
    runtimeBinding: RuntimeBindingArtifactSchema,
    notionDocumentationReference: OpaqueNotionDocumentationReferenceSchema,
    recordDigest: RecordDigestSchema,
  })
  .strict()
  .superRefine((record, ctx) => {
    const subject = {
      specId: record.spec.specId,
      version: record.spec.version,
      contentHash: record.spec.contentHash,
    };
    const evaluationSubject = record.evaluationEvidence.subject;
    const approvalSubject = record.approvalArtifact;
    const bindingSubject = record.runtimeBinding;

    if (!contentHashMatches(record.spec)) {
      ctx.addIssue({ code: "custom", path: ["spec", "contentHash"], message: "traceability spec content hash mismatch" });
    }

    for (const [field, actual] of [
      ["evaluationEvidence.subject.specId", evaluationSubject.specId],
      ["approvalArtifact.specId", approvalSubject.specId],
      ["runtimeBinding.specId", bindingSubject.specId],
    ] as const) {
      if (actual !== subject.specId) {
        ctx.addIssue({ code: "custom", path: field.split("."), message: "traceability subject specId mismatch" });
      }
    }
    for (const [field, actual] of [
      ["evaluationEvidence.subject.version", evaluationSubject.version],
      ["approvalArtifact.version", approvalSubject.version],
      ["runtimeBinding.version", bindingSubject.version],
    ] as const) {
      if (actual !== subject.version) {
        ctx.addIssue({ code: "custom", path: field.split("."), message: "traceability subject version mismatch" });
      }
    }
    for (const [field, actual] of [
      ["evaluationEvidence.subject.contentHash", evaluationSubject.contentHash],
      ["approvalArtifact.contentHash", approvalSubject.contentHash],
      ["runtimeBinding.contentHash", bindingSubject.contentHash],
    ] as const) {
      if (actual !== subject.contentHash) {
        ctx.addIssue({ code: "custom", path: field.split("."), message: "traceability subject contentHash mismatch" });
      }
    }

    if (record.approvalArtifact.decision !== "approved") {
      ctx.addIssue({ code: "custom", path: ["approvalArtifact", "decision"], message: "traceability requires an approved agent-spec artifact" });
    }
    if (bindingSubject.approvalArtifactId !== approvalSubject.artifactId) {
      ctx.addIssue({ code: "custom", path: ["runtimeBinding", "approvalArtifactId"], message: "runtime binding approval lineage mismatch" });
    }
    const approvalEvaluation = approvalSubject.evidence.evaluationRef;
    if (
      approvalEvaluation === undefined ||
      JSON.stringify(canonicalize(approvalEvaluation)) !==
        JSON.stringify(canonicalize(record.evaluationEvidence))
    ) {
      ctx.addIssue({ code: "custom", path: ["evaluationEvidence"], message: "traceability evaluation evidence is not the exact approval evidence" });
    }

    const evaluationAt = Date.parse(record.evaluationEvidence.completedAt);
    const approvalAt = Date.parse(record.approvalArtifact.decidedAt ?? "");
    const bindingAt = Date.parse(record.runtimeBinding.deployedAt);
    const recordedAt = Date.parse(record.recordedAt);
    if (Number.isNaN(evaluationAt) || Number.isNaN(approvalAt) || Number.isNaN(bindingAt) || Number.isNaN(recordedAt)) {
      ctx.addIssue({ code: "custom", path: ["recordedAt"], message: "traceability timestamps must be parseable instants" });
    } else if (evaluationAt > approvalAt || approvalAt > bindingAt || bindingAt > recordedAt) {
      ctx.addIssue({ code: "custom", path: ["recordedAt"], message: "traceability evidence must be chronological and never future-dated" });
    }

    const { recordDigest, ...unsignedRecord } = record;
    if (recordDigest !== computeAgentSpecTraceabilityDigest(unsignedRecord)) {
      ctx.addIssue({ code: "custom", path: ["recordDigest"], message: "traceability record digest mismatch" });
    }
  });

export type AgentSpecTraceabilityRecord = z.infer<typeof AgentSpecTraceabilityRecordSchema>;

export interface AgentSpecTraceabilityRecordInput {
  readonly recordedAt: string;
  readonly spec: AgentSpecContent;
  readonly evaluationEvidence: EvaluationOutcome;
  readonly approvalArtifact: AgentSpecApproval;
  readonly runtimeBinding: RuntimeBindingArtifact;
  readonly notionDocumentationReference: OpaqueNotionDocumentationReference;
}

export interface UnsignedAgentSpecTraceabilityRecord {
  readonly schemaVersion: "agent-spec-traceability/1";
  readonly recordedAt: string;
  readonly spec: AgentSpecContent;
  readonly evaluationEvidence: EvaluationOutcome;
  readonly approvalArtifact: AgentSpecApproval;
  readonly runtimeBinding: RuntimeBindingArtifact;
  readonly notionDocumentationReference: OpaqueNotionDocumentationReference;
}

export function computeAgentSpecTraceabilityDigest(
  record: UnsignedAgentSpecTraceabilityRecord,
): string {
  return createHash("sha256")
    .update("agent-builder/traceability-record/1\n")
    .update(JSON.stringify(canonicalize(record)))
    .digest("hex");
}

/**
 * Creates data only. It does not read Notion, create an approval, sign evidence,
 * mutate lifecycle state, start a runtime, or grant any authority.
 */
export function createAgentSpecTraceabilityRecord(
  input: AgentSpecTraceabilityRecordInput,
): AgentSpecTraceabilityRecord {
  const unsignedRecord: UnsignedAgentSpecTraceabilityRecord = {
    schemaVersion: "agent-spec-traceability/1",
    ...input,
  };
  return AgentSpecTraceabilityRecordSchema.parse({
    ...unsignedRecord,
    recordDigest: computeAgentSpecTraceabilityDigest(unsignedRecord),
  });
}

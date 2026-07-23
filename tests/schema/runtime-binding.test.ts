import { describe, expect, it } from "vitest";
import {
  RuntimeBindingArtifactSchema,
  RuntimeBindingInputSchema,
  TrustedRuntimeBindingContextSchema,
  RUNTIME_BINDING_BLOCK_REASONS,
  RuntimeBindingBlockReasonCodeSchema,
} from "../../src/schema/runtime-binding.js";
import { AgentSpecRuntimeMetadataSchema } from "../../src/schema/agent-spec-runtime-metadata.js";
import { ApprovalArtifactSchema } from "../../src/schema/approval-artifact.js";
import { validAgentSpecContent } from "../fixtures/specs.js";

const approvedMetadata = AgentSpecRuntimeMetadataSchema.parse({
  specId: "spec-crm-enricher",
  version: "1.0.0",
  state: "approved",
  stateHistory: [
    { state: "draft", actor: "builder-agent", timestamp: "2026-07-20T10:00:00Z", reason: "initial draft" },
    { state: "approved", actor: "release-manager", timestamp: "2026-07-23T12:00:00Z", reason: "approved" },
  ],
  requestor: "builder-agent",
});

const approvedArtifact = ApprovalArtifactSchema.parse({
  type: "agent_spec",
  artifactId: "approval-crm-enricher-001",
  requestedBy: "builder-agent",
  decision: "approved",
  decidedBy: "release-manager",
  decidedAt: "2026-07-23T12:00:00Z",
  specId: "spec-crm-enricher",
  version: "1.0.0",
  contentHash: "hash-v1",
  evidence: {
    policyOutcome: "approved_pending_gate",
    delta: "initial",
    evaluationRef: { suiteRef: "suite-crm-v1", score: 0.95 },
  },
});

describe("Runtime binding schemas", () => {
  it("accepts a runtime binding artifact bound to approval and content hash", () => {
    expect(
      RuntimeBindingArtifactSchema.safeParse({
        bindingId: "binding-crm-enricher-001",
        specId: "spec-crm-enricher",
        version: "1.0.0",
        contentHash: "hash-v1",
        approvalArtifactId: "approval-crm-enricher-001",
        runtimeInstanceId: "runtime-crm-enricher-001",
        deployedAt: "2026-07-23T12:30:00Z",
        ttl: 3600,
      }).success,
    ).toBe(true);
  });

  it("rejects a runtime binding artifact without approval lineage", () => {
    expect(
      RuntimeBindingArtifactSchema.safeParse({
        bindingId: "binding-crm-enricher-001",
        specId: "spec-crm-enricher",
        version: "1.0.0",
        contentHash: "hash-v1",
        runtimeInstanceId: "runtime-crm-enricher-001",
        deployedAt: "2026-07-23T12:30:00Z",
        ttl: 3600,
      }).success,
    ).toBe(false);
  });

  it("accepts runtime binding input with spec, metadata, and approval", () => {
    expect(
      RuntimeBindingInputSchema.safeParse({
        spec: validAgentSpecContent,
        metadata: approvedMetadata,
        approval: approvedArtifact,
      }).success,
    ).toBe(true);
  });

  it("requires actor in trusted runtime binding context", () => {
    expect(
      TrustedRuntimeBindingContextSchema.safeParse({
        bindingId: "binding-crm-enricher-001",
        runtimeInstanceId: "runtime-crm-enricher-001",
        deployedAt: "2026-07-23T12:30:00Z",
        ttl: 3600,
        actor: "deployment-executor",
      }).success,
    ).toBe(true);

    expect(
      TrustedRuntimeBindingContextSchema.safeParse({
        bindingId: "binding-crm-enricher-001",
        runtimeInstanceId: "runtime-crm-enricher-001",
        deployedAt: "2026-07-23T12:30:00Z",
        ttl: 3600,
      }).success,
    ).toBe(false);
  });

  it("rejects ambiguous deployedAt timestamps at the binding boundary", () => {
    expect(
      TrustedRuntimeBindingContextSchema.safeParse({
        bindingId: "binding-crm-enricher-001",
        runtimeInstanceId: "runtime-crm-enricher-001",
        deployedAt: "2026-07-23T12:30:00",
        ttl: 3600,
        actor: "deployment-executor",
      }).success,
    ).toBe(false);
  });

  it("keeps block reason codes in the closed schema catalog", () => {
    for (const reason of RUNTIME_BINDING_BLOCK_REASONS) {
      expect(RuntimeBindingBlockReasonCodeSchema.safeParse(reason).success).toBe(true);
    }
  });
});


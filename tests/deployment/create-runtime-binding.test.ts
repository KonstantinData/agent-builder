import { describe, expect, it } from "vitest";
import { createRuntimeBinding } from "../../src/deployment/create-runtime-binding.js";
import { AgentSpecRuntimeMetadataSchema, type AgentSpecRuntimeMetadata } from "../../src/schema/agent-spec-runtime-metadata.js";
import { ApprovalArtifactSchema, type ApprovalArtifact } from "../../src/schema/approval-artifact.js";
import type { TrustedRuntimeBindingContext } from "../../src/schema/runtime-binding.js";
import { MAX_RUNTIME_BINDING_TTL_SECONDS } from "../../src/schema/runtime-binding-validity.js";
import { evaluationFor, validAgentSpecContent } from "../fixtures/specs.js";

function metadataInState(state: string, overrides: Record<string, unknown> = {}): AgentSpecRuntimeMetadata {
  return AgentSpecRuntimeMetadataSchema.parse({
    specId: "spec-crm-enricher",
    version: "1.0.0",
    state,
    stateHistory: [
      { state: "draft", actor: "agent-builder", timestamp: "2026-07-20T10:00:00Z", reason: "initial draft" },
      { state, actor: "konstantin", timestamp: "2026-07-23T12:00:00Z", reason: "test state" },
    ],
    requestor: "agent-builder",
    ...overrides,
  });
}

const approvedMetadata = metadataInState("approved");

function approval(overrides: Record<string, unknown> = {}): ApprovalArtifact {
  return ApprovalArtifactSchema.parse({
    type: "agent_spec",
    artifactId: "approval-crm-enricher-001",
    requestedBy: "agent-builder",
    decision: "approved",
    decidedBy: "konstantin",
    decidedAt: "2026-07-23T12:00:00Z",
    specId: "spec-crm-enricher",
    version: "1.0.0",
    contentHash: validAgentSpecContent.contentHash,
    evidence: {
      policyOutcome: "approved_pending_gate",
      delta: "initial",
      evaluationRef: evaluationFor(validAgentSpecContent),
    },
    ...overrides,
  });
}

const ctx: TrustedRuntimeBindingContext = {
  bindingId: "binding-crm-enricher-001",
  runtimeInstanceId: "runtime-crm-enricher-001",
  deployedAt: "2026-07-23T12:30:00Z",
  ttl: 3600,
  actor: "deployment-executor",
};

describe("createRuntimeBinding", () => {
  it("creates runtime binding evidence and transitions approved metadata to deployed", () => {
    const result = createRuntimeBinding(
      { spec: validAgentSpecContent, metadata: approvedMetadata, approval: approval() },
      ctx,
    );

    expect(result.outcome).toBe("deployed");
    if (result.outcome !== "deployed") return;

    expect(result.binding).toEqual({
      bindingId: "binding-crm-enricher-001",
      specId: "spec-crm-enricher",
      version: "1.0.0",
      contentHash: validAgentSpecContent.contentHash,
      approvalArtifactId: "approval-crm-enricher-001",
      runtimeInstanceId: "runtime-crm-enricher-001",
      deployedAt: "2026-07-23T12:30:00Z",
      ttl: 3600,
    });
    expect(result.metadata.state).toBe("deployed");
    expect(result.metadata.deploymentBinding).toEqual({
      bindingId: "binding-crm-enricher-001",
      contentHash: validAgentSpecContent.contentHash,
      runtimeInstanceId: "runtime-crm-enricher-001",
      deployedAt: "2026-07-23T12:30:00Z",
      ttl: 3600,
    });
    expect(result.metadata.stateHistory.at(-1)).toEqual({
      state: "deployed",
      actor: "deployment-executor",
      timestamp: "2026-07-23T12:30:00Z",
      reason: "runtime binding created (binding-crm-enricher-001)",
    });
  });

  it("uses the trusted context reason when supplied", () => {
    const result = createRuntimeBinding(
      { spec: validAgentSpecContent, metadata: approvedMetadata, approval: approval() },
      { ...ctx, reason: "bound to runtime slot a" },
    );
    if (result.outcome !== "deployed") throw new Error("expected deployed");
    expect(result.metadata.stateHistory.at(-1)?.reason).toBe("bound to runtime slot a");
  });

  it("copies the maximum valid TTL and explicit-offset deployedAt through the binding boundary", () => {
    const result = createRuntimeBinding(
      { spec: validAgentSpecContent, metadata: approvedMetadata, approval: approval() },
      {
        ...ctx,
        deployedAt: "2026-07-23T14:30:00+02:00",
        ttl: MAX_RUNTIME_BINDING_TTL_SECONDS,
      },
    );

    if (result.outcome !== "deployed") throw new Error("expected deployed");
    expect(result.binding.deployedAt).toBe("2026-07-23T14:30:00+02:00");
    expect(result.binding.ttl).toBe(MAX_RUNTIME_BINDING_TTL_SECONDS);
    expect(result.metadata.deploymentBinding?.deployedAt).toBe("2026-07-23T14:30:00+02:00");
    expect(result.metadata.deploymentBinding?.ttl).toBe(MAX_RUNTIME_BINDING_TTL_SECONDS);
  });

  it.each(["draft", "in_review", "deployed", "suspended", "revoked", "rejected"])(
    "blocks non-deployable metadata state `%s`",
    (state) => {
      expect(
        createRuntimeBinding(
          { spec: validAgentSpecContent, metadata: metadataInState(state), approval: approval() },
          ctx,
        ),
      ).toEqual({
        outcome: "blocked",
        reason: { type: "runtime_binding_state_not_deployable", state },
      });
    },
  );

  it("blocks spec and metadata subject mismatch", () => {
    const metadata = AgentSpecRuntimeMetadataSchema.parse({ ...approvedMetadata, version: "9.9.9" });
    expect(
      createRuntimeBinding({ spec: validAgentSpecContent, metadata, approval: approval() }, ctx),
    ).toEqual({
      outcome: "blocked",
      reason: { type: "runtime_binding_subject_mismatch", specId: "spec-crm-enricher", version: "1.0.0" },
    });
  });

  it("blocks non-agent-spec and non-approved approval artifacts", () => {
    const edgeApproval = ApprovalArtifactSchema.parse({
      type: "call_graph_edge",
      artifactId: "approval-edge-001",
      requestedBy: "builder-agent",
      decision: "approved",
      decidedBy: "release-manager",
      decidedAt: "2026-07-23T12:00:00Z",
      edge: {
        callerSpecId: "spec-crm-enricher",
        callerVersion: "1.0.0",
        calleeSpecId: "spec-web-search",
        calleeVersionOrChannel: "1.0.0",
        allowedIntents: ["query"],
        dataShareScope: "tenant:acme:crm",
        maxDepth: 1,
        maxCallsPerRun: 3,
        maxCallsPerTimeWindow: 100,
        requiresHumanGate: false,
        trustDomainId: "domain-sales",
      },
    });
    expect(
      createRuntimeBinding({ spec: validAgentSpecContent, metadata: approvedMetadata, approval: edgeApproval }, ctx),
    ).toEqual({
      outcome: "blocked",
      reason: { type: "runtime_binding_approval_invalid", reason: "approval_not_approved_agent_spec" },
    });

    expect(
      createRuntimeBinding(
        { spec: validAgentSpecContent, metadata: approvedMetadata, approval: approval({ decision: "rejected", evidence: { policyOutcome: "rejected", rejectionReasonCodes: ["evaluation_below_threshold"] } }) },
        ctx,
      ),
    ).toEqual({
      outcome: "blocked",
      reason: { type: "runtime_binding_approval_invalid", reason: "approval_not_approved_agent_spec" },
    });
  });

  it("fails closed when a malformed approved artifact reaches the binding boundary", () => {
    const malformed = { ...approval(), decidedBy: undefined } as unknown as ApprovalArtifact;
    expect(
      createRuntimeBinding(
        { spec: validAgentSpecContent, metadata: approvedMetadata, approval: malformed },
        ctx,
      ),
    ).toEqual({
      outcome: "blocked",
      reason: { type: "input_invalid", reason: "schema_validation_failed" },
    });
  });

  it("blocks approval subject mismatch by contentHash", () => {
    expect(
      createRuntimeBinding(
        { spec: validAgentSpecContent, metadata: approvedMetadata, approval: approval({ contentHash: "hash-other" }) },
        ctx,
      ),
    ).toEqual({
      outcome: "blocked",
      reason: { type: "runtime_binding_approval_subject_mismatch", specId: "spec-crm-enricher", version: "1.0.0" },
    });
  });

  it("fails closed when the bound spec no longer recomputes to its content hash", () => {
    const tampered = { ...validAgentSpecContent, objective: "tampered after approval" };
    expect(createRuntimeBinding({ spec: tampered, metadata: approvedMetadata, approval: approval() }, ctx)).toEqual({
      outcome: "blocked",
      reason: {
        type: "runtime_binding_content_hash_mismatch",
        specId: "spec-crm-enricher",
        version: "1.0.0",
      },
    });
  });

  it("blocks an existing deployment binding on approved metadata", () => {
    const metadata = metadataInState("approved", {
      deploymentBinding: {
        bindingId: "binding-existing",
        contentHash: validAgentSpecContent.contentHash,
        runtimeInstanceId: "runtime-existing",
        deployedAt: "2026-07-23T12:15:00Z",
        ttl: 3600,
      },
    });
    expect(
      createRuntimeBinding({ spec: validAgentSpecContent, metadata, approval: approval() }, ctx),
    ).toEqual({
      outcome: "blocked",
      reason: { type: "runtime_binding_already_exists", bindingId: "binding-existing" },
    });
  });

  it("blocks invalid trusted runtime context", () => {
    expect(
      createRuntimeBinding(
        { spec: validAgentSpecContent, metadata: approvedMetadata, approval: approval() },
        { ...ctx, actor: "" },
      ),
    ).toEqual({
      outcome: "blocked",
      reason: { type: "runtime_binding_context_invalid", reason: "schema_validation_failed" },
    });

    expect(
      createRuntimeBinding(
        { spec: validAgentSpecContent, metadata: approvedMetadata, approval: approval() },
        { ...ctx, deployedAt: "2026-07-23T12:30:00" },
      ),
    ).toEqual({
      outcome: "blocked",
      reason: { type: "runtime_binding_context_invalid", reason: "schema_validation_failed" },
    });

    expect(
      createRuntimeBinding(
        { spec: validAgentSpecContent, metadata: approvedMetadata, approval: approval() },
        { ...ctx, ttl: MAX_RUNTIME_BINDING_TTL_SECONDS + 1 },
      ),
    ).toEqual({
      outcome: "blocked",
      reason: { type: "runtime_binding_context_invalid", reason: "schema_validation_failed" },
    });
  });

  it("is pure: does not mutate input metadata or its state history", () => {
    const snapshot = structuredClone(approvedMetadata);
    createRuntimeBinding({ spec: validAgentSpecContent, metadata: approvedMetadata, approval: approval() }, ctx);
    expect(approvedMetadata).toEqual(snapshot);
  });
});


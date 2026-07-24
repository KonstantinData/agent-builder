import { describe, expect, it } from "vitest";
import { DecidedCallGraphEdgeApprovalSchema } from "../../src/schema/approval-artifact.js";
import {
  AgentLifecycleEvidencePayloadSchema,
  CallGraphEdgeApprovalEvidencePayloadSchema,
  RunContextEvidencePayloadSchema,
  RUNTIME_BINDING_ATTESTATION_DOMAIN,
} from "../../src/schema/runtime-attestation.js";
import {
  RUNTIME_AUTHORIZATION_BLOCK_REASONS,
  RuntimeActionSchema,
  RuntimeAuthorizationBlockReasonCodeSchema,
  RuntimeAuthorizationInputSchema,
  RuntimeBudgetSchema,
  TrustedRuntimeAuthorizationContextSchema,
} from "../../src/schema/runtime-authorization.js";
import { RuntimeBindingArtifactSchema } from "../../src/schema/runtime-binding.js";
import { validAgentSpecContent } from "../fixtures/specs.js";
import {
  TEST_TRUSTED_ATTESTATION_KEY,
  attestCallGraphEdgeApproval,
  attestLifecycle,
  attestRunContext,
  signPayload,
} from "../support/runtime-attestation.js";

const bindingPayload = RuntimeBindingArtifactSchema.parse({
  bindingId: "binding-001",
  specId: "spec-crm-enricher",
  version: "1.0.0",
  contentHash: "hash-v1",
  approvalArtifactId: "approval-spec-001",
  runtimeInstanceId: "runtime-001",
  deployedAt: "2026-07-23T12:30:00Z",
  ttl: 3600,
});

const actingPayload = AgentLifecycleEvidencePayloadSchema.parse({
  specId: "spec-crm-enricher",
  versionOrChannel: "1.0.0",
  state: "deployed",
  assertedAt: "2026-07-23T12:59:00Z",
  freshnessTtl: 300,
});

const bindingEvidence = {
  payload: bindingPayload,
  attestation: signPayload(RUNTIME_BINDING_ATTESTATION_DOMAIN, bindingPayload),
};
const actingLifecycleEvidence = attestLifecycle(actingPayload, "acting");

const callContext = {
  rootRunId: "run-root",
  parentRunId: null,
  callChain: ["spec-crm-enricher"],
  remainingDepth: 2,
  remainingCallBudget: 3,
  remainingTokenBudget: 20_000,
  remainingTimeBudget: 30_000,
};

const runContextPayload = RunContextEvidencePayloadSchema.parse({
  specId: "spec-crm-enricher",
  version: "1.0.0",
  contentHash: "hash-v1",
  currentRunId: "run-root",
  callContext,
  assertedAt: "2026-07-23T12:59:00Z",
  freshnessTtl: 300,
});
const runContextEvidence = attestRunContext(runContextPayload);

const edgeApprovalPayload = DecidedCallGraphEdgeApprovalSchema.parse({
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
const edgeApprovalEvidencePayload = CallGraphEdgeApprovalEvidencePayloadSchema.parse({
  approval: edgeApprovalPayload,
  assertedAt: "2026-07-23T12:59:00Z",
  freshnessTtl: 300,
});
const edgeApprovalEvidence = attestCallGraphEdgeApproval(edgeApprovalEvidencePayload);

const candidate = {
  spec: validAgentSpecContent,
  runtimeBindingEvidence: bindingEvidence,
  actingLifecycleEvidence,
  runContextEvidence,
  action: { type: "tool_call", toolId: "crm.enrich", scope: "tenant:acme:crm" },
  attestedEdgeApprovals: [edgeApprovalEvidence],
};

describe("Runtime authorization schemas", () => {
  it("accepts runtime budgets in runtime spend-down dimensions", () => {
    expect(
      RuntimeBudgetSchema.safeParse({ callBudget: 1, tokenBudget: 1_000, timeBudget: 5_000 }).success,
    ).toBe(true);
    expect(
      RuntimeBudgetSchema.safeParse({ costCeiling: 1, maxIterations: 1, timeoutMs: 5_000 }).success,
    ).toBe(false);
  });

  it("accepts tool and agent runtime actions", () => {
    expect(
      RuntimeActionSchema.safeParse({
        type: "tool_call",
        toolId: "crm.enrich",
        scope: "tenant:acme:crm",
      }).success,
    ).toBe(true);
    expect(
      RuntimeActionSchema.safeParse({
        type: "agent_call",
        calleeSpecId: "spec-web-search",
        calleeVersionOrChannel: "1.0.0",
        intent: "query",
        childBudget: { callBudget: 1, tokenBudget: 1_000, timeBudget: 5_000 },
      }).success,
    ).toBe(true);
  });

  it("requires acting, run-context, and edge approval evidence while keeping binding and callee evidence structurally optional", () => {
    expect(RuntimeAuthorizationInputSchema.safeParse(candidate).success).toBe(true);
    const { runtimeBindingEvidence: _binding, ...withoutBinding } = candidate;
    expect(RuntimeAuthorizationInputSchema.safeParse(withoutBinding).success).toBe(true);
    const { actingLifecycleEvidence: _acting, ...withoutActing } = candidate;
    expect(RuntimeAuthorizationInputSchema.safeParse(withoutActing).success).toBe(false);
    const { runContextEvidence: _runContext, ...withoutRunContext } = candidate;
    expect(RuntimeAuthorizationInputSchema.safeParse(withoutRunContext).success).toBe(false);
    const { attestedEdgeApprovals: _edges, ...withoutEdges } = candidate;
    expect(RuntimeAuthorizationInputSchema.safeParse(withoutEdges).success).toBe(false);
    expect(
      RuntimeAuthorizationInputSchema.safeParse({
        ...candidate,
        attestedEdgeApprovals: [],
      }).success,
    ).toBe(true);

    const agentCandidate = {
      ...candidate,
      action: {
        type: "agent_call",
        calleeSpecId: "spec-web-search",
        calleeVersionOrChannel: "1.0.0",
        intent: "query",
        childBudget: { callBudget: 1, tokenBudget: 1_000, timeBudget: 5_000 },
      },
    };
    expect(RuntimeAuthorizationInputSchema.safeParse(agentCandidate).success).toBe(true);
  });

  it("rejects legacy metadata, raw approval fields, and malformed presented evidence", () => {
    expect(
      RuntimeAuthorizationInputSchema.safeParse({ ...candidate, metadata: { state: "deployed" } }).success,
    ).toBe(false);
    expect(
      RuntimeAuthorizationInputSchema.safeParse({
        ...candidate,
        callContext,
        currentRunId: "run-root",
      }).success,
    ).toBe(false);
    expect(
      RuntimeAuthorizationInputSchema.safeParse({
        ...candidate,
        attestedEdgeApprovals: [edgeApprovalPayload.edge],
      }).success,
    ).toBe(false);
    expect(
      RuntimeAuthorizationInputSchema.safeParse({
        ...candidate,
        attestedEdgeApprovals: [
          {
            payload: edgeApprovalPayload,
            attestation: edgeApprovalEvidence.attestation,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      RuntimeAuthorizationInputSchema.safeParse({
        ...candidate,
        edgeApprovals: [edgeApprovalPayload],
      }).success,
    ).toBe(false);
    expect(
      RuntimeAuthorizationInputSchema.safeParse({
        ...candidate,
        attestedEdgeApprovals: [
          {
            ...edgeApprovalEvidence,
            payload: {
              ...edgeApprovalEvidencePayload,
              approval: { ...edgeApprovalPayload, decision: "pending" },
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      RuntimeAuthorizationInputSchema.safeParse({
        ...candidate,
        canonicalAuthorityResult: { kind: "subject_absent" },
      }).success,
    ).toBe(false);
    expect(
      RuntimeAuthorizationInputSchema.safeParse({
        ...candidate,
        canonicalAuthorityResolver: "caller-selected",
      }).success,
    ).toBe(false);
    expect(
      RuntimeAuthorizationInputSchema.safeParse({
        ...candidate,
        calleeLifecycleEvidence: {
          payload: { ...actingPayload, freshnessTtl: 301 },
          attestation: actingLifecycleEvidence.attestation,
        },
      }).success,
    ).toBe(false);
  });

  it("accepts trusted time plus a valid keyset and rejects ambiguous contexts", () => {
    expect(
      TrustedRuntimeAuthorizationContextSchema.safeParse({
        authorizationTime: "2026-07-23T12:00:00Z",
        attestationKeys: [TEST_TRUSTED_ATTESTATION_KEY],
      }).success,
    ).toBe(true);
    expect(
      TrustedRuntimeAuthorizationContextSchema.safeParse({
        authorizationTime: "2026-07-23T12:00:00",
        attestationKeys: [TEST_TRUSTED_ATTESTATION_KEY],
      }).success,
    ).toBe(false);
    expect(
      TrustedRuntimeAuthorizationContextSchema.safeParse({
        authorizationTime: "2026-07-23T12:00:00Z",
        attestationKeys: [],
      }).success,
    ).toBe(false);
    expect(
      TrustedRuntimeAuthorizationContextSchema.safeParse({
        authorizationTime: "2026-07-23T12:00:00Z",
        attestationKeys: [TEST_TRUSTED_ATTESTATION_KEY],
        canonicalAuthorityResult: { kind: "subject_absent" },
      }).success,
    ).toBe(false);
  });

  it("keeps the structured block-reason union in the closed catalog", () => {
    for (const reason of RUNTIME_AUTHORIZATION_BLOCK_REASONS) {
      expect(RuntimeAuthorizationBlockReasonCodeSchema.safeParse(reason).success).toBe(true);
    }
    expect(
      RuntimeAuthorizationBlockReasonCodeSchema.safeParse("callee_lifecycle_subject_mismatch").success,
    ).toBe(false);
    expect(RuntimeAuthorizationBlockReasonCodeSchema.safeParse("attestation_missing").success).toBe(false);
  });
});

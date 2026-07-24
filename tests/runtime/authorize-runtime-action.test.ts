import { describe, expect, it, vi } from "vitest";
import { computeContentHash } from "../../src/assembler/content-hash.js";
import {
  CALLEE_CALLABLE_STATES,
  RUNTIME_EXECUTABLE_STATES,
  createRuntimeAuthorizer,
  type AgentCallAuthorizationReservationAdapter,
  type CanonicalEdgeAuthorityResolver,
} from "../../src/runtime/authorize-runtime-action.js";
import { computeCallGraphEdgeApprovalDecisionDigest } from "../../src/runtime/edge-approval-digest.js";
import { DecidedCallGraphEdgeApprovalSchema } from "../../src/schema/approval-artifact.js";
import type { AgentCallAuthorizationReservationRequestV1 } from "../../src/schema/agent-call-authorization-reservation.js";
import { AgentSpecContentSchema, type AgentSpecContent } from "../../src/schema/agent-spec-content.js";
import { LifecycleStateSchema } from "../../src/schema/agent-spec-runtime-metadata.js";
import { CallContextSchema, type CallContext } from "../../src/schema/call-context.js";
import { SpecIdSchema } from "../../src/schema/common.js";
import {
  AgentLifecycleEvidencePayloadSchema,
  CallGraphEdgeApprovalEvidencePayloadSchema,
  type AttestationEvidenceKind,
  type AttestedAgentLifecycleEvidence,
  type AttestedCallGraphEdgeApproval,
  type AttestedRunContextEvidence,
  type AttestedRuntimeBindingEvidence,
  RunContextEvidencePayloadSchema,
} from "../../src/schema/runtime-attestation.js";
import {
  type AgentCallRuntimeAction,
  type RuntimeAuthorizationInput,
  type TrustedRuntimeAuthorizationContext,
} from "../../src/schema/runtime-authorization.js";
import { RuntimeBindingArtifactSchema } from "../../src/schema/runtime-binding.js";
import { validAgentSpecContent } from "../fixtures/specs.js";
import {
  SECOND_TEST_ATTESTATION_KEY_ID,
  SECOND_TEST_TRUSTED_ATTESTATION_KEY,
  TEST_ATTESTATION_KEY_ID,
  TEST_TRUSTED_ATTESTATION_KEY,
  attestLifecycle,
  attestCallGraphEdgeApproval,
  attestRuntimeBinding,
  attestRunContext,
} from "../support/runtime-attestation.js";

function specFixture(overrides: Record<string, unknown> = {}): AgentSpecContent {
  const parsed = AgentSpecContentSchema.parse({
    ...validAgentSpecContent,
    ...overrides,
    contentHash: "pending-recompute",
  });
  const { contentHash: _ignored, ...contentWithoutHash } = parsed;
  return AgentSpecContentSchema.parse({
    ...contentWithoutHash,
    contentHash: computeContentHash(contentWithoutHash),
  });
}

const runtimeSpec = specFixture();

function runtimeBindingEvidence(
  spec: AgentSpecContent = runtimeSpec,
  overrides: Record<string, unknown> = {},
): AttestedRuntimeBindingEvidence {
  const payload = RuntimeBindingArtifactSchema.parse({
    bindingId: "binding-crm-enricher-001",
    specId: spec.specId,
    version: spec.version,
    contentHash: spec.contentHash,
    approvalArtifactId: "approval-spec-001",
    runtimeInstanceId: "runtime-crm-enricher-001",
    deployedAt: "2026-07-23T12:30:00Z",
    ttl: 3600,
    ...overrides,
  });
  return attestRuntimeBinding(payload);
}

function lifecycleEvidence(
  role: "acting" | "callee",
  overrides: Record<string, unknown> = {},
): AttestedAgentLifecycleEvidence {
  const defaults =
    role === "acting"
      ? { specId: runtimeSpec.specId, versionOrChannel: runtimeSpec.version }
      : {
          specId: SpecIdSchema.parse("spec-web-search"),
          versionOrChannel: "1.0.0",
        };
  const payload = AgentLifecycleEvidencePayloadSchema.parse({
    ...defaults,
    state: "deployed",
    assertedAt: "2026-07-23T12:59:00Z",
    freshnessTtl: 300,
    ...overrides,
  });
  return attestLifecycle(payload, role);
}

const authorizationContext: TrustedRuntimeAuthorizationContext = {
  authorizationTime: "2026-07-23T13:00:00Z",
  attestationKeys: [TEST_TRUSTED_ATTESTATION_KEY],
};

function contextWithoutEvidenceKind(
  evidenceKind: AttestationEvidenceKind,
): TrustedRuntimeAuthorizationContext {
  return {
    ...authorizationContext,
    attestationKeys: [
      {
        ...TEST_TRUSTED_ATTESTATION_KEY,
        allowedEvidenceKinds: TEST_TRUSTED_ATTESTATION_KEY.allowedEvidenceKinds.filter(
          (allowedKind) => allowedKind !== evidenceKind,
        ),
      },
    ],
  };
}

function defaultCanonicalAuthorityResolver(
  input: RuntimeAuthorizationInput,
): CanonicalEdgeAuthorityResolver {
  return async (request) => {
    const currentApproval = input.attestedEdgeApprovals.find(
      (evidence) =>
        evidence.payload.approval.decision === "approved" &&
        evidence.payload.approval.edge.callerSpecId === request.subject.callerSpecId &&
        evidence.payload.approval.edge.callerVersion === request.subject.callerVersion &&
        evidence.payload.approval.edge.calleeSpecId === request.subject.calleeSpecId &&
        evidence.payload.approval.edge.calleeVersionOrChannel ===
          request.subject.calleeVersionOrChannel &&
        evidence.payload.approval.edge.trustDomainId === request.subject.trustDomainId,
    );
    if (currentApproval === undefined) {
      return {
        kind: "subject_absent",
        subject: request.subject,
        asOf: request.asOf,
        observedAt: request.asOf,
      };
    }
    return {
      kind: "found",
      subject: request.subject,
      asOf: request.asOf,
      observedAt: request.asOf,
      record: {
        subject: request.subject,
        authorityRevision: 1,
        approvalDigest: computeCallGraphEdgeApprovalDecisionDigest(
          currentApproval.payload.approval,
        ),
        status: "active",
      },
    };
  };
}

const defaultAuthorizationReservationAdapter: AgentCallAuthorizationReservationAdapter =
  async (request) => ({
    kind: "reserved",
    receipt: {
      ...request,
      reservedAt: request.authorizationTime,
    },
  });

async function authorizeRuntimeActionWithContext(
  input: RuntimeAuthorizationInput,
  context: TrustedRuntimeAuthorizationContext,
  resolver: CanonicalEdgeAuthorityResolver = defaultCanonicalAuthorityResolver(input),
  reservationAdapter: AgentCallAuthorizationReservationAdapter =
    defaultAuthorizationReservationAdapter,
) {
  return createRuntimeAuthorizer({
    canonicalAuthorityResolver: resolver,
    timeoutPolicy: { timeoutMs: 1_000 },
    authorizationReservationAdapter: reservationAdapter,
    authorizationReservationTimeoutPolicy: { timeoutMs: 1_000 },
  }).authorizeRuntimeAction(input, context);
}

async function authorizeRuntimeAction(
  input: RuntimeAuthorizationInput,
  overrides: Partial<TrustedRuntimeAuthorizationContext> = {},
  resolver: CanonicalEdgeAuthorityResolver = defaultCanonicalAuthorityResolver(input),
  reservationAdapter: AgentCallAuthorizationReservationAdapter =
    defaultAuthorizationReservationAdapter,
) {
  return await authorizeRuntimeActionWithContext(input, {
    ...authorizationContext,
    ...overrides,
  }, resolver, reservationAdapter);
}

async function authorizeWithReservationAdapter(
  input: RuntimeAuthorizationInput,
  reservationAdapter: AgentCallAuthorizationReservationAdapter,
  overrides: Partial<TrustedRuntimeAuthorizationContext> = {},
  resolver: CanonicalEdgeAuthorityResolver = defaultCanonicalAuthorityResolver(input),
) {
  return authorizeRuntimeAction(input, overrides, resolver, reservationAdapter);
}

function callContext(overrides: Record<string, unknown> = {}): CallContext {
  return CallContextSchema.parse({
    rootRunId: "run-root",
    parentRunId: "run-parent",
    callChain: ["spec-crm-enricher"],
    remainingDepth: 2,
    remainingCallBudget: 3,
    remainingTokenBudget: 20_000,
    remainingTimeBudget: 30_000,
    ...overrides,
  });
}

function runContextEvidence(
  spec: AgentSpecContent = runtimeSpec,
  overrides: Record<string, unknown> = {},
): AttestedRunContextEvidence {
  const payload = RunContextEvidencePayloadSchema.parse({
    specId: spec.specId,
    version: spec.version,
    contentHash: spec.contentHash,
    currentRunId: "run-current",
    callContext: callContext({ callChain: [spec.specId] }),
    assertedAt: "2026-07-23T12:59:00Z",
    freshnessTtl: 300,
    ...overrides,
  });
  return attestRunContext(payload);
}

function edgeApproval(
  edgeOverrides: Record<string, unknown> = {},
  approvalOverrides: Record<string, unknown> = {},
  evidenceOverrides: Record<string, unknown> = {},
): AttestedCallGraphEdgeApproval {
  const approval = DecidedCallGraphEdgeApprovalSchema.parse({
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
      ...edgeOverrides,
    },
    ...approvalOverrides,
  });
  const payload = CallGraphEdgeApprovalEvidencePayloadSchema.parse({
    approval,
    assertedAt: "2026-07-23T12:59:00Z",
    freshnessTtl: 300,
    ...evidenceOverrides,
  });
  return attestCallGraphEdgeApproval(payload);
}

function baseInput(overrides: Partial<RuntimeAuthorizationInput> = {}): RuntimeAuthorizationInput {
  const spec = overrides.spec ?? runtimeSpec;
  return {
    spec,
    runtimeBindingEvidence: runtimeBindingEvidence(spec),
    actingLifecycleEvidence: lifecycleEvidence("acting", {
      specId: spec.specId,
      versionOrChannel: spec.version,
    }),
    runContextEvidence: runContextEvidence(spec),
    action: { type: "tool_call", toolId: "crm.enrich", scope: "tenant:acme:crm" },
    attestedEdgeApprovals: [edgeApproval()],
    ...overrides,
  };
}

const agentAction = {
  type: "agent_call",
  calleeSpecId: SpecIdSchema.parse("spec-web-search"),
  calleeVersionOrChannel: "1.0.0",
  intent: "query",
  childBudget: { callBudget: 1, tokenBudget: 5_000, timeBudget: 10_000 },
} satisfies AgentCallRuntimeAction;

function agentInput(overrides: Partial<RuntimeAuthorizationInput> = {}): RuntimeAuthorizationInput {
  return baseInput({
    action: agentAction,
    calleeLifecycleEvidence: lifecycleEvidence("callee"),
    ...overrides,
  });
}

function agentInputWithFreshSupportingEvidence(
  assertedAt: string,
  attestedEdgeApprovals: ReadonlyArray<AttestedCallGraphEdgeApproval>,
): RuntimeAuthorizationInput {
  return agentInput({
    actingLifecycleEvidence: lifecycleEvidence("acting", { assertedAt }),
    runContextEvidence: runContextEvidence(runtimeSpec, { assertedAt }),
    calleeLifecycleEvidence: lifecycleEvidence("callee", { assertedAt }),
    attestedEdgeApprovals,
  });
}

function mutateSignature<T extends AttestedRuntimeBindingEvidence | AttestedAgentLifecycleEvidence | AttestedCallGraphEdgeApproval | AttestedRunContextEvidence>(
  evidence: T,
): T {
  const signature = Buffer.from(evidence.attestation.signatureBase64, "base64");
  signature[0] = (signature[0] ?? 0) ^ 1;
  return {
    ...evidence,
    attestation: {
      ...evidence.attestation,
      signatureBase64: signature.toString("base64"),
    },
  };
}

describe("authorizeRuntimeAction Step 10 evidence boundary", () => {
  it("allows an exact declared tool call with attested binding and acting lifecycle evidence", async () => {
    expect(await authorizeRuntimeAction(baseInput())).toEqual({
      outcome: "allowed",
      actionType: "tool_call",
    });
  });

  it("fails input validation before trusted-context validation", async () => {
    const valid = baseInput();
    const input = {
      ...valid,
      runContextEvidence: {
        ...valid.runContextEvidence,
        payload: { ...valid.runContextEvidence.payload, currentRunId: "" },
      },
    } as RuntimeAuthorizationInput;
    expect(
      await authorizeRuntimeActionWithContext(input, {
        authorizationTime: "not-a-time",
        attestationKeys: [],
      } as TrustedRuntimeAuthorizationContext),
    ).toEqual({
      outcome: "blocked",
      reason: { type: "input_invalid", reason: "schema_validation_failed" },
    });
  });

  it("requires the trusted context and rejects malformed or duplicate keysets", async () => {
    // @ts-expect-error Trusted authorization time and keyset are mandatory.
    expect(await authorizeRuntimeActionWithContext(baseInput())).toEqual({
      outcome: "blocked",
      reason: {
        type: "runtime_authorization_context_invalid",
        reason: "schema_validation_failed",
      },
    });

    for (const context of [
      { ...authorizationContext, authorizationTime: "2026-07-23T13:00:00" },
      { ...authorizationContext, attestationKeys: [] },
      {
        ...authorizationContext,
        attestationKeys: [
          TEST_TRUSTED_ATTESTATION_KEY,
          { ...SECOND_TEST_TRUSTED_ATTESTATION_KEY, keyId: TEST_ATTESTATION_KEY_ID },
        ],
      },
      {
        ...authorizationContext,
        attestationKeys: [
          { ...TEST_TRUSTED_ATTESTATION_KEY, publicKeySpkiDerBase64: "AA==" },
        ],
      },
    ]) {
      expect(
        await authorizeRuntimeActionWithContext(
          baseInput({ runtimeBindingEvidence: undefined }),
          context as TrustedRuntimeAuthorizationContext,
        ),
      ).toEqual({
        outcome: "blocked",
        reason: {
          type: "runtime_authorization_context_invalid",
          reason: "schema_validation_failed",
        },
      });
    }
  });

  it("rejects legacy mutable runtime metadata at the strict input boundary", async () => {
    const input = {
      ...baseInput(),
      metadata: { specId: runtimeSpec.specId, version: runtimeSpec.version, state: "deployed" },
    } as unknown as RuntimeAuthorizationInput;
    expect(await authorizeRuntimeAction(input)).toEqual({
      outcome: "blocked",
      reason: { type: "input_invalid", reason: "schema_validation_failed" },
    });
  });

  it("requires acting lifecycle evidence structurally for every action", async () => {
    const { actingLifecycleEvidence: _ignored, ...input } = baseInput();
    expect(
      await authorizeRuntimeAction(input as RuntimeAuthorizationInput),
    ).toEqual({
      outcome: "blocked",
      reason: { type: "input_invalid", reason: "schema_validation_failed" },
    });
  });

  it("blocks missing runtime binding evidence before acting lifecycle evaluation", async () => {
    expect(
      await authorizeRuntimeAction(
        baseInput({
          runtimeBindingEvidence: undefined,
          actingLifecycleEvidence: mutateSignature(lifecycleEvidence("acting")),
        }),
      ),
    ).toEqual({
      outcome: "blocked",
      reason: {
        type: "runtime_binding_missing",
        specId: runtimeSpec.specId,
        version: runtimeSpec.version,
      },
    });
  });

  it.each([
    ["runtime_binding", "runtimeBindingEvidence"],
    ["acting_lifecycle", "actingLifecycleEvidence"],
  ] as const)("blocks unknown keys for %s evidence before signature verification", async (evidenceKind, field) => {
    const evidence = {
      ...(field === "runtimeBindingEvidence"
        ? runtimeBindingEvidence()
        : lifecycleEvidence("acting")),
      attestation: {
        ...(field === "runtimeBindingEvidence"
          ? runtimeBindingEvidence().attestation
          : lifecycleEvidence("acting").attestation),
        keyId: "unknown-key",
      },
    };
    expect(await authorizeRuntimeAction(baseInput({ [field]: evidence }))).toEqual({
      outcome: "blocked",
      reason: { type: "attestation_key_unknown", evidenceKind, keyId: "unknown-key" },
    });
  });

  it.each(["runtime_binding", "acting_lifecycle"] as const)(
    "treats a trusted key without `%s` authority as unknown for that evidence kind",
    async (evidenceKind) => {
      expect(
        await authorizeRuntimeActionWithContext(
          baseInput(),
          contextWithoutEvidenceKind(evidenceKind),
        ),
      ).toEqual({
        outcome: "blocked",
        reason: {
          type: "attestation_key_unknown",
          evidenceKind,
          keyId: TEST_ATTESTATION_KEY_ID,
        },
      });
    },
  );

  it.each([
    ["runtime_binding", "runtimeBindingEvidence"],
    ["acting_lifecycle", "actingLifecycleEvidence"],
  ] as const)("blocks invalid signatures for %s evidence", async (evidenceKind, field) => {
    const evidence =
      field === "runtimeBindingEvidence"
        ? mutateSignature(runtimeBindingEvidence())
        : mutateSignature(lifecycleEvidence("acting"));
    expect(await authorizeRuntimeAction(baseInput({ [field]: evidence }))).toEqual({
      outcome: "blocked",
      reason: { type: "attestation_invalid", evidenceKind, keyId: TEST_ATTESTATION_KEY_ID },
    });
  });

  it("treats a keyId switched to another trusted key as an invalid signature", async () => {
    const evidence = runtimeBindingEvidence();
    expect(
      await authorizeRuntimeAction(
        baseInput({
          runtimeBindingEvidence: {
            ...evidence,
            attestation: {
              ...evidence.attestation,
              keyId: SECOND_TEST_ATTESTATION_KEY_ID,
            },
          },
        }),
        { attestationKeys: [TEST_TRUSTED_ATTESTATION_KEY, SECOND_TEST_TRUSTED_ATTESTATION_KEY] },
      ),
    ).toEqual({
      outcome: "blocked",
      reason: {
        type: "attestation_invalid",
        evidenceKind: "runtime_binding",
        keyId: SECOND_TEST_ATTESTATION_KEY_ID,
      },
    });
  });

  it("verifies binding signatures before artifact subject, hash, and lease guards", async () => {
    const evidence = runtimeBindingEvidence(runtimeSpec, {
      specId: "spec-other",
      contentHash: "wrong-hash",
      deployedAt: "2026-07-23T10:00:00Z",
      ttl: 1,
    });
    expect(
      await authorizeRuntimeAction(
        baseInput({ runtimeBindingEvidence: mutateSignature(evidence) }),
      ),
    ).toEqual({
      outcome: "blocked",
      reason: {
        type: "attestation_invalid",
        evidenceKind: "runtime_binding",
        keyId: TEST_ATTESTATION_KEY_ID,
      },
    });
  });

  it.each([
    { specId: "spec-other" },
    { version: "9.9.9" },
  ])("re-sources runtime subject mismatch to the attested artifact: %o", async (overrides) => {
    expect(
      await authorizeRuntimeAction(
        baseInput({ runtimeBindingEvidence: runtimeBindingEvidence(runtimeSpec, overrides) }),
      ),
    ).toEqual({
      outcome: "blocked",
      reason: {
        type: "runtime_subject_mismatch",
        specId: runtimeSpec.specId,
        version: runtimeSpec.version,
      },
    });
  });

  it("blocks a self-inconsistent presented spec contentHash", async () => {
    const spec = AgentSpecContentSchema.parse({ ...runtimeSpec, contentHash: "self-inconsistent" });
    expect(
      await authorizeRuntimeAction(
        baseInput({ spec, runtimeBindingEvidence: runtimeBindingEvidence(spec) }),
      ),
    ).toEqual({
      outcome: "blocked",
      reason: {
        type: "runtime_binding_content_hash_mismatch",
        specId: spec.specId,
        version: spec.version,
      },
    });
  });

  it("blocks a validly signed artifact whose contentHash differs from recomputed spec content", async () => {
    expect(
      await authorizeRuntimeAction(
        baseInput({
          runtimeBindingEvidence: runtimeBindingEvidence(runtimeSpec, {
            contentHash: "validly-signed-but-wrong",
          }),
        }),
      ),
    ).toEqual({
      outcome: "blocked",
      reason: {
        type: "runtime_binding_content_hash_mismatch",
        specId: runtimeSpec.specId,
        version: runtimeSpec.version,
      },
    });
  });

  it("blocks when recomputed content matches the artifact but not the presented spec hash", async () => {
    const selfInconsistentSpec = AgentSpecContentSchema.parse({
      ...runtimeSpec,
      contentHash: "presented-spec-hash-is-wrong",
    });
    expect(
      await authorizeRuntimeAction(
        baseInput({
          spec: selfInconsistentSpec,
          runtimeBindingEvidence: runtimeBindingEvidence(selfInconsistentSpec, {
            contentHash: runtimeSpec.contentHash,
          }),
          actingLifecycleEvidence: lifecycleEvidence("acting", {
            specId: selfInconsistentSpec.specId,
            versionOrChannel: selfInconsistentSpec.version,
          }),
        }),
      ),
    ).toEqual({
      outcome: "blocked",
      reason: {
        type: "runtime_binding_content_hash_mismatch",
        specId: selfInconsistentSpec.specId,
        version: selfInconsistentSpec.version,
      },
    });
  });

  it("detects spec-content mutation even when the presented hashes remain unchanged", async () => {
    const mutatedSpec = AgentSpecContentSchema.parse({
      ...runtimeSpec,
      objective: "Tampered objective",
    });
    expect(
      await authorizeRuntimeAction(
        baseInput({
          spec: mutatedSpec,
          runtimeBindingEvidence: runtimeBindingEvidence(mutatedSpec, {
            contentHash: runtimeSpec.contentHash,
          }),
        }),
      ),
    ).toMatchObject({ reason: { type: "runtime_binding_content_hash_mismatch" } });
  });

  it("evaluates the attested binding over the Step-8 half-open lease", async () => {
    const offsetBinding = runtimeBindingEvidence(runtimeSpec, {
      deployedAt: "2026-07-23T14:30:00+02:00",
    });
    expect(
      await authorizeRuntimeAction(
        baseInput({
          runtimeBindingEvidence: offsetBinding,
          actingLifecycleEvidence: lifecycleEvidence("acting", {
            assertedAt: "2026-07-23T12:30:00Z",
          }),
          runContextEvidence: runContextEvidence(runtimeSpec, {
            assertedAt: "2026-07-23T12:30:00Z",
          }),
        }),
        { authorizationTime: "2026-07-23T12:30:00Z" },
      ),
    ).toEqual({ outcome: "allowed", actionType: "tool_call" });

    expect(
      await authorizeRuntimeAction(baseInput(), { authorizationTime: "2026-07-23T12:29:59.999Z" }),
    ).toMatchObject({ reason: { type: "runtime_binding_not_yet_valid" } });
    expect(
      await authorizeRuntimeAction(
        baseInput({
          actingLifecycleEvidence: lifecycleEvidence("acting", {
            assertedAt: "2026-07-23T13:29:00Z",
          }),
          runContextEvidence: runContextEvidence(runtimeSpec, {
            assertedAt: "2026-07-23T13:29:00Z",
          }),
        }),
        { authorizationTime: "2026-07-23T13:29:59.999Z" },
      ),
    ).toEqual({ outcome: "allowed", actionType: "tool_call" });
    expect(
      await authorizeRuntimeAction(baseInput(), { authorizationTime: "2026-07-23T13:30:00Z" }),
    ).toMatchObject({ reason: { type: "runtime_binding_expired" } });
  });

  it("lets content-hash failure beat expiry and expiry beat acting lifecycle", async () => {
    expect(
      await authorizeRuntimeAction(
        baseInput({
          runtimeBindingEvidence: runtimeBindingEvidence(runtimeSpec, { contentHash: "wrong" }),
        }),
        { authorizationTime: "2026-07-23T14:00:00Z" },
      ),
    ).toMatchObject({ reason: { type: "runtime_binding_content_hash_mismatch" } });

    expect(
      await authorizeRuntimeAction(
        baseInput({ actingLifecycleEvidence: mutateSignature(lifecycleEvidence("acting")) }),
        { authorizationTime: "2026-07-23T14:00:00Z" },
      ),
    ).toMatchObject({ reason: { type: "runtime_binding_expired" } });
  });
});

describe("authorizeRuntimeAction acting lifecycle", () => {
  const nonExecutableStates = LifecycleStateSchema.options.filter(
    (state) => !RUNTIME_EXECUTABLE_STATES.some((executableState) => executableState === state),
  );

  it("keeps acting executability distinct and limited to deployed", async () => {
    expect(RUNTIME_EXECUTABLE_STATES).toEqual(["deployed"]);
    expect(nonExecutableStates).toEqual([
      "draft",
      "in_review",
      "approved",
      "suspended",
      "revoked",
      "rejected",
    ]);
  });

  it.each(nonExecutableStates)("blocks signed acting state `%s` as non-executable", async (state) => {
    expect(
      await authorizeRuntimeAction(
        baseInput({ actingLifecycleEvidence: lifecycleEvidence("acting", { state }) }),
      ),
    ).toEqual({
      outcome: "blocked",
      reason: { type: "runtime_state_not_executable", state },
    });
  });

  it.each([
    { specId: "spec-other" },
    { versionOrChannel: "stable" },
  ])("blocks acting lifecycle subject mismatch: %o", async (overrides) => {
    expect(
      await authorizeRuntimeAction(
        baseInput({ actingLifecycleEvidence: lifecycleEvidence("acting", overrides) }),
      ),
    ).toEqual({
      outcome: "blocked",
      reason: {
        type: "lifecycle_evidence_subject_mismatch",
        role: "acting",
        specId: runtimeSpec.specId,
        versionOrChannel: runtimeSpec.version,
      },
    });
  });

  it("checks acting signature before subject, state, and freshness", async () => {
    const evidence = lifecycleEvidence("acting", {
      specId: "spec-other",
      state: "revoked",
      assertedAt: "2026-07-23T14:00:00Z",
    });
    expect(
      await authorizeRuntimeAction(baseInput({ actingLifecycleEvidence: mutateSignature(evidence) })),
    ).toMatchObject({ reason: { type: "attestation_invalid", evidenceKind: "acting_lifecycle" } });
  });

  it("rejects a callee-domain signature replayed as acting evidence", async () => {
    const payload = AgentLifecycleEvidencePayloadSchema.parse({
      ...lifecycleEvidence("acting").payload,
    });
    expect(
      await authorizeRuntimeAction(
        baseInput({ actingLifecycleEvidence: attestLifecycle(payload, "callee") }),
      ),
    ).toMatchObject({
      reason: { type: "attestation_invalid", evidenceKind: "acting_lifecycle" },
    });
  });

  it("treats acting freshness as a half-open interval with no skew grace", async () => {
    const assertedAt = "2026-07-23T13:00:00Z";
    const evidence = lifecycleEvidence("acting", { assertedAt, freshnessTtl: 300 });
    const freshRunContext = runContextEvidence(runtimeSpec, { assertedAt, freshnessTtl: 300 });

    expect(
      await authorizeRuntimeAction(baseInput({ actingLifecycleEvidence: evidence, runContextEvidence: freshRunContext }), {
        authorizationTime: assertedAt,
      }),
    ).toEqual({ outcome: "allowed", actionType: "tool_call" });
    expect(
      await authorizeRuntimeAction(baseInput({ actingLifecycleEvidence: evidence, runContextEvidence: freshRunContext }), {
        authorizationTime: "2026-07-23T12:59:59.999Z",
      }),
    ).toMatchObject({
      reason: { type: "lifecycle_evidence_not_fresh", role: "acting", condition: "from_future" },
    });
    expect(
      await authorizeRuntimeAction(baseInput({ actingLifecycleEvidence: evidence, runContextEvidence: freshRunContext }), {
        authorizationTime: "2026-07-23T13:04:59.999Z",
      }),
    ).toEqual({ outcome: "allowed", actionType: "tool_call" });
    expect(
      await authorizeRuntimeAction(baseInput({ actingLifecycleEvidence: evidence, runContextEvidence: freshRunContext }), {
        authorizationTime: "2026-07-23T13:05:00Z",
      }),
    ).toMatchObject({
      reason: { type: "lifecycle_evidence_not_fresh", role: "acting", condition: "expired" },
    });
  });

  it("compares lifecycle freshness as absolute instants across offsets", async () => {
    expect(
      await authorizeRuntimeAction(
        baseInput({
          actingLifecycleEvidence: lifecycleEvidence("acting", {
            assertedAt: "2026-07-23T15:00:00+02:00",
          }),
        }),
        { authorizationTime: "2026-07-23T13:00:00Z" },
      ),
    ).toEqual({ outcome: "allowed", actionType: "tool_call" });
  });

  it("lets non-executable acting state beat invalid freshness", async () => {
    expect(
      await authorizeRuntimeAction(
        baseInput({
          actingLifecycleEvidence: lifecycleEvidence("acting", {
            state: "revoked",
            assertedAt: "2026-07-23T14:00:00Z",
          }),
        }),
      ),
    ).toEqual({
      outcome: "blocked",
      reason: { type: "runtime_state_not_executable", state: "revoked" },
    });
  });

  it("lets acting freshness beat call-context and action failures", async () => {
    expect(
      await authorizeRuntimeAction(
        baseInput({
          actingLifecycleEvidence: lifecycleEvidence("acting", {
            assertedAt: "2026-07-23T12:00:00Z",
            freshnessTtl: 300,
          }),
          runContextEvidence: runContextEvidence(runtimeSpec, {
            callContext: callContext({ callChain: ["spec-other"] }),
          }),
          action: { type: "tool_call", toolId: "email.send", scope: "tenant:acme:crm" },
        }),
      ),
    ).toMatchObject({
      reason: { type: "lifecycle_evidence_not_fresh", role: "acting", condition: "expired" },
    });
  });
});

describe("authorizeRuntimeAction Step 12 run-context evidence", () => {
  it("accepts both valid root and child run topology", async () => {
    expect(await authorizeRuntimeAction(baseInput())).toEqual({
      outcome: "allowed",
      actionType: "tool_call",
    });
    expect(
      await authorizeRuntimeAction(
        baseInput({
          runContextEvidence: runContextEvidence(runtimeSpec, {
            currentRunId: "run-root",
            callContext: callContext({ parentRunId: null }),
          }),
        }),
      ),
    ).toEqual({ outcome: "allowed", actionType: "tool_call" });
  });

  it("maps missing key purpose and invalid signatures to generic attestation reasons", async () => {
    expect(
      await authorizeRuntimeAction(baseInput(), contextWithoutEvidenceKind("run_context")),
    ).toEqual({
      outcome: "blocked",
      reason: {
        type: "attestation_key_unknown",
        evidenceKind: "run_context",
        keyId: TEST_ATTESTATION_KEY_ID,
      },
    });
    expect(
      await authorizeRuntimeAction(
        baseInput({
          runContextEvidence: mutateSignature(runContextEvidence()),
        }),
      ),
    ).toEqual({
      outcome: "blocked",
      reason: {
        type: "attestation_invalid",
        evidenceKind: "run_context",
        keyId: TEST_ATTESTATION_KEY_ID,
      },
    });
  });

  it("rejects a lifecycle-domain signature replayed as run-context evidence", async () => {
    const evidence = runContextEvidence();
    expect(
      await authorizeRuntimeAction(
        baseInput({
          runContextEvidence: {
            payload: evidence.payload,
            attestation: attestLifecycle(
              AgentLifecycleEvidencePayloadSchema.parse({
                specId: runtimeSpec.specId,
                versionOrChannel: runtimeSpec.version,
                state: "deployed",
                assertedAt: "2026-07-23T12:59:00Z",
                freshnessTtl: 300,
              }),
              "acting",
            ).attestation,
          },
        }),
      ),
    ).toMatchObject({
      reason: { type: "attestation_invalid", evidenceKind: "run_context" },
    });
  });

  it.each([
    { specId: "spec-other" },
    { version: "9.9.9" },
    { contentHash: "f".repeat(64) },
  ])("binds the signed run context to the exact acting subject: %s", async (payloadOverride) => {
    expect(
      await authorizeRuntimeAction(
        baseInput({
          runContextEvidence: runContextEvidence(runtimeSpec, payloadOverride),
        }),
      ),
    ).toEqual({
      outcome: "blocked",
      reason: {
        type: "run_context_subject_mismatch",
        specId: runtimeSpec.specId,
        version: runtimeSpec.version,
      },
    });
  });

  it("isolates cross-trust-domain replay at the run-context content-hash join", async () => {
    const domainBSpec = specFixture({ trustDomainId: "domain-operations" });
    expect(domainBSpec.contentHash).not.toBe(runtimeSpec.contentHash);
    expect(
      await authorizeRuntimeAction(
        baseInput({
          spec: domainBSpec,
          runtimeBindingEvidence: runtimeBindingEvidence(domainBSpec),
          actingLifecycleEvidence: lifecycleEvidence("acting", {
            specId: domainBSpec.specId,
            versionOrChannel: domainBSpec.version,
          }),
          runContextEvidence: runContextEvidence(runtimeSpec),
        }),
      ),
    ).toEqual({
      outcome: "blocked",
      reason: {
        type: "run_context_subject_mismatch",
        specId: domainBSpec.specId,
        version: domainBSpec.version,
      },
    });
  });

  it("uses a half-open run-context freshness window with no skew grace", async () => {
    const assertedAt = "2026-07-23T13:00:00Z";
    const evidence = runContextEvidence(runtimeSpec, { assertedAt, freshnessTtl: 300 });

    expect(
      await authorizeRuntimeAction(
        baseInput({ runContextEvidence: evidence }),
        { authorizationTime: assertedAt },
      ),
    ).toEqual({ outcome: "allowed", actionType: "tool_call" });
    expect(
      await authorizeRuntimeAction(
        baseInput({ runContextEvidence: evidence }),
        { authorizationTime: "2026-07-23T12:59:59.999Z" },
      ),
    ).toMatchObject({ reason: { type: "run_context_not_fresh", condition: "from_future" } });
    expect(
      await authorizeRuntimeAction(
        baseInput({
          actingLifecycleEvidence: lifecycleEvidence("acting", { assertedAt }),
          runContextEvidence: evidence,
        }),
        { authorizationTime: "2026-07-23T13:04:59.999Z" },
      ),
    ).toEqual({ outcome: "allowed", actionType: "tool_call" });
    expect(
      await authorizeRuntimeAction(
        baseInput({
          actingLifecycleEvidence: lifecycleEvidence("acting", {
            assertedAt: "2026-07-23T13:04:00Z",
          }),
          runContextEvidence: evidence,
        }),
        { authorizationTime: "2026-07-23T13:05:00Z" },
      ),
    ).toMatchObject({ reason: { type: "run_context_not_fresh", condition: "expired" } });
  });

  it("compares run-context freshness as absolute instants across offsets", async () => {
    expect(
      await authorizeRuntimeAction(
        baseInput({
          runContextEvidence: runContextEvidence(runtimeSpec, {
            assertedAt: "2026-07-23T15:00:00+02:00",
          }),
        }),
        { authorizationTime: "2026-07-23T13:00:00Z" },
      ),
    ).toEqual({ outcome: "allowed", actionType: "tool_call" });
  });

  it.each([
    {
      overrides: { callContext: callContext({ callChain: ["spec-other"] }) },
      condition: "call_chain_tail_mismatch",
    },
    {
      overrides: {
        currentRunId: "run-child",
        callContext: callContext({ parentRunId: null }),
      },
      condition: "root_parent_relation_invalid",
    },
    {
      overrides: {
        currentRunId: "run-root",
        callContext: callContext({ parentRunId: "run-parent" }),
      },
      condition: "root_parent_relation_invalid",
    },
    {
      overrides: {
        currentRunId: "run-child",
        callContext: callContext({ parentRunId: "run-child" }),
      },
      condition: "parent_equals_current",
    },
  ] as const)("blocks signed but inconsistent topology: $condition", async ({ overrides, condition }) => {
    expect(
      await authorizeRuntimeAction(
        baseInput({ runContextEvidence: runContextEvidence(runtimeSpec, overrides) }),
      ),
    ).toEqual({
      outcome: "blocked",
      reason: { type: "run_context_invalid", condition },
    });
  });

  it("pins global and run-context guard precedence before action semantics", async () => {
    const invalidTopology = runContextEvidence(runtimeSpec, {
      callContext: callContext({ callChain: ["spec-other"] }),
    });
    expect(
      await authorizeRuntimeAction(
        baseInput({ runtimeBindingEvidence: undefined, runContextEvidence: invalidTopology }),
      ),
    ).toMatchObject({ reason: { type: "runtime_binding_missing" } });
    expect(
      await authorizeRuntimeAction(
        baseInput({
          actingLifecycleEvidence: lifecycleEvidence("acting", {
            assertedAt: "2026-07-23T12:00:00Z",
          }),
          runContextEvidence: invalidTopology,
        }),
      ),
    ).toMatchObject({ reason: { type: "lifecycle_evidence_not_fresh", role: "acting" } });

    const forged = mutateSignature(
      runContextEvidence(runtimeSpec, {
        specId: "spec-other",
        assertedAt: "2026-07-23T12:00:00Z",
        callContext: callContext({ callChain: ["spec-other"] }),
      }),
    );
    expect(
      await authorizeRuntimeAction(
        baseInput({
          runContextEvidence: forged,
          action: { type: "tool_call", toolId: "email.send", scope: "tenant:acme:crm" },
        }),
      ),
    ).toMatchObject({ reason: { type: "attestation_invalid", evidenceKind: "run_context" } });

    expect(
      await authorizeRuntimeAction(
        baseInput({
          runContextEvidence: runContextEvidence(runtimeSpec, {
            contentHash: "f".repeat(64),
            assertedAt: "2026-07-23T12:00:00Z",
            callContext: callContext({ callChain: ["spec-other"] }),
          }),
        }),
      ),
    ).toMatchObject({ reason: { type: "run_context_subject_mismatch" } });

    expect(
      await authorizeRuntimeAction(
        baseInput({
          runContextEvidence: runContextEvidence(runtimeSpec, {
            assertedAt: "2026-07-23T12:00:00Z",
            callContext: callContext({ callChain: ["spec-other"] }),
          }),
        }),
      ),
    ).toMatchObject({ reason: { type: "run_context_not_fresh", condition: "expired" } });

    expect(
      await authorizeRuntimeAction(
        baseInput({
          runContextEvidence: invalidTopology,
          action: { type: "tool_call", toolId: "email.send", scope: "tenant:acme:crm" },
        }),
      ),
    ).toMatchObject({ reason: { type: "run_context_invalid" } });
  });

  it("derives identical logical reservation output for identical presentations", async () => {
    const input = agentInput();
    const first = await authorizeRuntimeAction(input);
    const second = await authorizeRuntimeAction(input);
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      outcome: "allowed",
      actionType: "agent_call",
      childRunContextDraft: {
        callContext: { parentRunId: "run-current" },
      },
    });
    if (first.outcome === "allowed" && first.actionType === "agent_call") {
      expect(Object.keys(first.childRunContextDraft).sort()).toEqual([
        "callContext",
        "calleeSpecId",
        "calleeVersionOrChannel",
      ]);
    }
  });
});

describe("authorizeRuntimeAction tool semantics", () => {
  it("ignores any structurally valid callee evidence for tool calls", async () => {
    const evidence = lifecycleEvidence("callee", {
      specId: "spec-foreign",
      versionOrChannel: "stable",
      state: "revoked",
      assertedAt: "2026-07-23T10:00:00Z",
    });
    expect(
      await authorizeRuntimeAction(
        baseInput({
          calleeLifecycleEvidence: {
            ...mutateSignature(evidence),
            attestation: { ...evidence.attestation, keyId: "unknown-key" },
          },
        }),
      ),
    ).toEqual({ outcome: "allowed", actionType: "tool_call" });
  });

  it("rejects structurally invalid callee evidence even for tool calls", async () => {
    const input = {
      ...baseInput(),
      calleeLifecycleEvidence: {
        payload: { specId: "spec-web-search", state: "deployed" },
        attestation: { keyId: "x", signatureBase64: "not-base64" },
      },
    } as unknown as RuntimeAuthorizationInput;
    expect(await authorizeRuntimeAction(input)).toEqual({
      outcome: "blocked",
      reason: { type: "input_invalid", reason: "schema_validation_failed" },
    });
  });

  it("ignores structurally valid edge evidence for tool calls without inspecting its key or signature", async () => {
    const unknownKey = edgeApproval();
    expect(
      await authorizeRuntimeAction(
        baseInput({
          attestedEdgeApprovals: [
            {
              ...unknownKey,
              attestation: { ...unknownKey.attestation, keyId: "unknown-key" },
            },
            mutateSignature(edgeApproval({ trustDomainId: "domain-foreign" })),
          ],
        }),
      ),
    ).toEqual({ outcome: "allowed", actionType: "tool_call" });
  });

  it("rejects structurally invalid edge evidence even for tool calls", async () => {
    const input = {
      ...baseInput(),
      attestedEdgeApprovals: [
        {
          payload: {
            ...edgeApproval().payload,
            approval: { ...edgeApproval().payload.approval, decision: "pending" },
          },
          attestation: edgeApproval().attestation,
        },
      ],
    } as unknown as RuntimeAuthorizationInput;
    expect(await authorizeRuntimeAction(input)).toEqual({
      outcome: "blocked",
      reason: { type: "input_invalid", reason: "schema_validation_failed" },
    });
  });

  it("keeps exact tool declaration and scope checks", async () => {
    expect(
      await authorizeRuntimeAction(
        baseInput({ action: { type: "tool_call", toolId: "email.send", scope: "tenant:acme:crm" } }),
      ),
    ).toEqual({ outcome: "blocked", reason: { type: "tool_not_declared", toolId: "email.send" } });
    expect(
      await authorizeRuntimeAction(
        baseInput({ action: { type: "tool_call", toolId: "crm.enrich", scope: "tenant:acme" } }),
      ),
    ).toEqual({
      outcome: "blocked",
      reason: { type: "tool_scope_not_allowed", toolId: "crm.enrich", scope: "tenant:acme" },
    });
  });
});

describe("authorizeRuntimeAction agent calls", () => {
  it("allows an approved agent call and returns an unsigned child run-context draft", async () => {
    expect(await authorizeRuntimeAction(agentInput())).toMatchObject({
      outcome: "allowed",
      actionType: "agent_call",
      childRunContextDraft: {
        calleeSpecId: "spec-web-search",
        calleeVersionOrChannel: "1.0.0",
        callContext: {
          rootRunId: "run-root",
          parentRunId: "run-current",
          callChain: ["spec-crm-enricher", "spec-web-search"],
          remainingDepth: 0,
          remainingCallBudget: 1,
          remainingTokenBudget: 5_000,
          remainingTimeBudget: 10_000,
        },
      },
    });
  });

  it("uses a half-open edge-approval authority lease with no skew grace", async () => {
    const authority = edgeApproval({}, {}, { assertedAt: "2026-07-23T13:00:00Z" });

    expect(
      await authorizeRuntimeAction(
        agentInputWithFreshSupportingEvidence("2026-07-23T12:59:00Z", [authority]),
        { authorizationTime: "2026-07-23T13:00:00Z" },
      ),
    ).toMatchObject({ outcome: "allowed" });
    expect(
      await authorizeRuntimeAction(
        agentInputWithFreshSupportingEvidence("2026-07-23T13:00:00Z", [authority]),
        { authorizationTime: "2026-07-23T13:04:59.999Z" },
      ),
    ).toMatchObject({ outcome: "allowed" });
    expect(
      await authorizeRuntimeAction(
        agentInputWithFreshSupportingEvidence("2026-07-23T13:04:00Z", [authority]),
        { authorizationTime: "2026-07-23T13:05:00Z" },
      ),
    ).toEqual({
      outcome: "blocked",
      reason: {
        type: "call_graph_edge_approval_not_fresh",
        condition: "expired",
        artifactId: "approval-edge-001",
      },
    });
    expect(
      await authorizeRuntimeAction(
        agentInputWithFreshSupportingEvidence("2026-07-23T12:59:00Z", [authority]),
        { authorizationTime: "2026-07-23T12:59:59.999Z" },
      ),
    ).toEqual({
      outcome: "blocked",
      reason: {
        type: "call_graph_edge_approval_not_fresh",
        condition: "from_future",
        artifactId: "approval-edge-001",
      },
    });
  });

  it("compares edge-approval freshness as absolute instants across offsets", async () => {
    const authority = edgeApproval(
      {},
      {},
      { assertedAt: "2026-07-23T14:59:00+02:00" },
    );
    expect(
      await authorizeRuntimeAction(
        agentInputWithFreshSupportingEvidence("2026-07-23T12:59:00Z", [authority]),
        { authorizationTime: "2026-07-23T13:00:00Z" },
      ),
    ).toMatchObject({ outcome: "allowed" });
  });

  it("requires a decision to exist no later than its authority assertion", async () => {
    const equalInstants = edgeApproval(
      {},
      { decidedAt: "2026-07-23T13:00:00Z" },
      { assertedAt: "2026-07-23T15:00:00+02:00" },
    );
    expect(
      await authorizeRuntimeAction(
        agentInputWithFreshSupportingEvidence("2026-07-23T12:59:00Z", [equalInstants]),
      ),
    ).toMatchObject({ outcome: "allowed" });

    const impossibleTimeline = edgeApproval(
      {},
      { decidedAt: "2026-07-23T13:00:00Z" },
      { assertedAt: "2026-07-23T12:59:59.999Z" },
    );
    expect(
      await authorizeRuntimeAction(
        agentInputWithFreshSupportingEvidence("2026-07-23T12:59:00Z", [impossibleTimeline]),
      ),
    ).toEqual({
      outcome: "blocked",
      reason: {
        type: "call_graph_edge_approval_invalid",
        condition: "decision_after_assertion",
        artifactId: "approval-edge-001",
      },
    });
  });

  it("checks approval causality before freshness for approved and rejected evidence", async () => {
    for (const decision of ["approved", "rejected"] as const) {
      const impossibleAndExpired = edgeApproval(
        {},
        {
          artifactId: `approval-edge-${decision}`,
          decision,
          ...(decision === "rejected" ? { reason: "denied" } : {}),
          decidedAt: "2026-07-23T13:01:00Z",
        },
        { assertedAt: "2026-07-23T12:00:00Z", freshnessTtl: 1 },
      );
      expect(
        await authorizeRuntimeAction(
          agentInputWithFreshSupportingEvidence("2026-07-23T12:59:00Z", [
            impossibleAndExpired,
          ]),
        ),
      ).toEqual({
        outcome: "blocked",
        reason: {
          type: "call_graph_edge_approval_invalid",
          condition: "decision_after_assertion",
          artifactId: `approval-edge-${decision}`,
        },
      });
    }
  });

  it("validates every relevant authority lease before filtering rejected decisions", async () => {
    const freshApproved = edgeApproval();
    const staleRejected = edgeApproval(
      {},
      {
        artifactId: "approval-edge-rejected",
        decision: "rejected",
        reason: "denied",
      },
      { assertedAt: "2026-07-23T12:00:00Z", freshnessTtl: 1 },
    );
    for (const approvals of [
      [freshApproved, staleRejected],
      [staleRejected, freshApproved],
    ]) {
      expect(
        await authorizeRuntimeAction(
          agentInputWithFreshSupportingEvidence("2026-07-23T12:59:00Z", approvals),
        ),
      ).toEqual({
        outcome: "blocked",
        reason: {
          type: "call_graph_edge_approval_not_fresh",
          condition: "expired",
          artifactId: "approval-edge-rejected",
        },
      });
    }
  });

  it("ignores stale subject-irrelevant edge evidence and all valid edge evidence for tool calls", async () => {
    const irrelevantStale = edgeApproval(
      { calleeSpecId: "spec-foreign" },
      { artifactId: "approval-edge-foreign" },
      { assertedAt: "2026-07-23T12:00:00Z", freshnessTtl: 1 },
    );
    expect(
      await authorizeRuntimeAction(
        agentInput({ attestedEdgeApprovals: [irrelevantStale, edgeApproval()] }),
      ),
    ).toMatchObject({ outcome: "allowed", actionType: "agent_call" });
    expect(
      await authorizeRuntimeAction(baseInput({ attestedEdgeApprovals: [irrelevantStale] })),
    ).toEqual({ outcome: "allowed", actionType: "tool_call" });
  });

  it("keeps binding and run-context guards ahead of edge-approval freshness", async () => {
    const staleAuthority = edgeApproval(
      {},
      {},
      { assertedAt: "2026-07-23T12:00:00Z", freshnessTtl: 1 },
    );
    expect(
      await authorizeRuntimeAction(
        agentInput({
          runtimeBindingEvidence: runtimeBindingEvidence(runtimeSpec, {
            deployedAt: "2026-07-23T10:00:00Z",
            ttl: 1,
          }),
          attestedEdgeApprovals: [staleAuthority],
        }),
      ),
    ).toMatchObject({ reason: { type: "runtime_binding_expired" } });
    expect(
      await authorizeRuntimeAction(
        agentInput({
          runContextEvidence: runContextEvidence(runtimeSpec, {
            assertedAt: "2026-07-23T12:00:00Z",
            freshnessTtl: 1,
          }),
          attestedEdgeApprovals: [staleAuthority],
        }),
      ),
    ).toMatchObject({ reason: { type: "run_context_not_fresh", condition: "expired" } });
  });

  it.each([
    { callerSpecId: "spec-other" },
    { callerVersion: "9.9.9" },
    { calleeSpecId: "spec-other" },
    { calleeVersionOrChannel: "stable" },
    { trustDomainId: "domain-foreign" },
  ])("treats a five-field edge subject mismatch as irrelevant: %o", async (edgeOverrides) => {
    expect(
      await authorizeRuntimeAction(
        agentInput({ attestedEdgeApprovals: [edgeApproval(edgeOverrides)] }),
      ),
    ).toEqual({
      outcome: "blocked",
      reason: {
        type: "call_edge_not_approved",
        calleeSpecId: "spec-web-search",
        calleeVersionOrChannel: "1.0.0",
      },
    });
  });

  it("never authorizes through tampered join fields", async () => {
    const foreign = edgeApproval({ calleeSpecId: "spec-foreign" });
    const tamperedIntoRelevance = {
      ...foreign,
      payload: {
        ...foreign.payload,
        approval: {
          ...foreign.payload.approval,
          edge: {
            ...foreign.payload.approval.edge,
            calleeSpecId: SpecIdSchema.parse("spec-web-search"),
          },
        },
      },
    };
    expect(
      await authorizeRuntimeAction(
        agentInput({ attestedEdgeApprovals: [tamperedIntoRelevance] }),
      ),
    ).toMatchObject({
      reason: { type: "attestation_invalid", evidenceKind: "call_graph_edge_approval" },
    });

    const relevant = edgeApproval();
    const tamperedOutOfRelevance = {
      ...relevant,
      payload: {
        ...relevant.payload,
        approval: {
          ...relevant.payload.approval,
          edge: {
            ...relevant.payload.approval.edge,
            calleeSpecId: SpecIdSchema.parse("spec-foreign"),
          },
        },
      },
    };
    expect(
      await authorizeRuntimeAction(
        agentInput({ attestedEdgeApprovals: [tamperedOutOfRelevance] }),
      ),
    ).toMatchObject({ reason: { type: "call_edge_not_approved" } });
  });

  it("ignores cryptographically invalid irrelevant evidence but verifies every relevant entry", async () => {
    const irrelevant = edgeApproval({ calleeSpecId: "spec-foreign" });
    const irrelevantUnknownKey = {
      ...irrelevant,
      attestation: { ...irrelevant.attestation, keyId: "unknown-key" },
    };
    expect(
      await authorizeRuntimeAction(
        agentInput({
          attestedEdgeApprovals: [
            irrelevantUnknownKey,
            mutateSignature(edgeApproval({ trustDomainId: "domain-foreign" })),
            edgeApproval(),
          ],
        }),
      ),
    ).toMatchObject({ outcome: "allowed", actionType: "agent_call" });

    expect(
      await authorizeRuntimeAction(
        agentInput({
          attestedEdgeApprovals: [
            edgeApproval(),
            mutateSignature(edgeApproval({}, { decision: "rejected", reason: "denied" })),
          ],
        }),
      ),
    ).toMatchObject({
      reason: { type: "attestation_invalid", evidenceKind: "call_graph_edge_approval" },
    });
  });

  it("uses input order for relevant attestation failures before decision filtering", async () => {
    const unknownKey = edgeApproval({}, { decision: "rejected", reason: "denied" });
    const withUnknownKey = {
      ...unknownKey,
      attestation: { ...unknownKey.attestation, keyId: "unknown-key" },
    };
    const invalidSignature = mutateSignature(
      edgeApproval({}, { decision: "rejected", reason: "denied" }),
    );

    expect(
      await authorizeRuntimeAction(
        agentInput({ attestedEdgeApprovals: [withUnknownKey, invalidSignature] }),
      ),
    ).toMatchObject({
      reason: { type: "attestation_key_unknown", evidenceKind: "call_graph_edge_approval" },
    });
    expect(
      await authorizeRuntimeAction(
        agentInput({ attestedEdgeApprovals: [invalidSignature, withUnknownKey] }),
      ),
    ).toMatchObject({
      reason: { type: "attestation_invalid", evidenceKind: "call_graph_edge_approval" },
    });
  });

  it("filters only verified rejected decisions before authority evaluation", async () => {
    const rejected = edgeApproval(
      { requiresHumanGate: true },
      { decision: "rejected", reason: "denied" },
    );
    expect(
      await authorizeRuntimeAction(agentInput({ attestedEdgeApprovals: [rejected] })),
    ).toMatchObject({ reason: { type: "call_edge_not_approved" } });
    expect(
      await authorizeRuntimeAction(
        agentInput({ attestedEdgeApprovals: [rejected, edgeApproval()] }),
      ),
    ).toMatchObject({ outcome: "allowed", actionType: "agent_call" });
  });

  it("treats a missing or wrong approval key scope identically to an unknown key", async () => {
    const evidence = edgeApproval();
    const unknownKeyEvidence = {
      ...evidence,
      attestation: { ...evidence.attestation, keyId: "unknown-key" },
    };
    expect(
      await authorizeRuntimeAction(
        agentInput({ attestedEdgeApprovals: [unknownKeyEvidence] }),
      ),
    ).toEqual({
      outcome: "blocked",
      reason: {
        type: "attestation_key_unknown",
        evidenceKind: "call_graph_edge_approval",
        keyId: "unknown-key",
      },
    });
    expect(
      await authorizeRuntimeActionWithContext(
        agentInput({ attestedEdgeApprovals: [mutateSignature(edgeApproval())] }),
        contextWithoutEvidenceKind("call_graph_edge_approval"),
      ),
    ).toEqual({
      outcome: "blocked",
      reason: {
        type: "attestation_key_unknown",
        evidenceKind: "call_graph_edge_approval",
        keyId: TEST_ATTESTATION_KEY_ID,
      },
    });
  });

  it("keeps lifecycle and approval key purposes independently scoped", async () => {
    expect(
      await authorizeRuntimeActionWithContext(
        agentInput(),
        contextWithoutEvidenceKind("callee_lifecycle"),
      ),
    ).toEqual({
      outcome: "blocked",
      reason: {
        type: "attestation_key_unknown",
        evidenceKind: "callee_lifecycle",
        keyId: TEST_ATTESTATION_KEY_ID,
      },
    });
  });

  it("keeps global and declaration guards ahead of edge attestation", async () => {
    const invalidApproval = mutateSignature(edgeApproval());
    expect(
      await authorizeRuntimeAction(
        agentInput({
          runtimeBindingEvidence: runtimeBindingEvidence(runtimeSpec, {
            deployedAt: "2026-07-23T10:00:00Z",
            ttl: 1,
          }),
          attestedEdgeApprovals: [invalidApproval],
        }),
      ),
    ).toMatchObject({ reason: { type: "runtime_binding_expired" } });

    const undeclaredAction = {
      ...agentAction,
      calleeSpecId: SpecIdSchema.parse("spec-billing"),
    };
    expect(
      await authorizeRuntimeAction(
        agentInput({
          action: undeclaredAction,
          attestedEdgeApprovals: [
            mutateSignature(edgeApproval({ calleeSpecId: "spec-billing" })),
          ],
        }),
      ),
    ).toMatchObject({ reason: { type: "agent_call_not_declared" } });
  });

  it("checks selected approval attestation before policy, cycle, and callee guards", async () => {
    expect(
      await authorizeRuntimeAction(
        agentInput({
          attestedEdgeApprovals: [
            mutateSignature(
              edgeApproval({ requiresHumanGate: true, allowedIntents: ["delegate"] }),
            ),
          ],
          runContextEvidence: runContextEvidence(runtimeSpec, {
            callContext: callContext({
              callChain: ["spec-web-search", "spec-crm-enricher"],
            }),
          }),
          calleeLifecycleEvidence: mutateSignature(lifecycleEvidence("callee")),
        }),
      ),
    ).toMatchObject({
      reason: { type: "attestation_invalid", evidenceKind: "call_graph_edge_approval" },
    });
  });

  it("deduplicates repeated presentation of the same canonical approved decision", async () => {
    const evidence = edgeApproval();
    expect(
      await authorizeRuntimeAction(
        agentInput({ attestedEdgeApprovals: [evidence, structuredClone(evidence)] }),
      ),
    ).toMatchObject({ outcome: "allowed", actionType: "agent_call" });
  });

  it("requires callee lifecycle evidence only after cycle detection", async () => {
    expect(await authorizeRuntimeAction(baseInput({ action: agentAction }))).toEqual({
      outcome: "blocked",
      reason: {
        type: "callee_lifecycle_evidence_missing",
        calleeSpecId: "spec-web-search",
        calleeVersionOrChannel: "1.0.0",
      },
    });
    expect(
      await authorizeRuntimeAction(
        baseInput({
          action: agentAction,
          runContextEvidence: runContextEvidence(runtimeSpec, {
            callContext: callContext({
              callChain: ["spec-web-search", "spec-crm-enricher"],
            }),
          }),
        }),
      ),
    ).toEqual({
      outcome: "blocked",
      reason: { type: "cycle_detected", calleeSpecId: "spec-web-search" },
    });
  });

  it("maps callee unknown keys and invalid signatures to generic attestation reasons", async () => {
    const evidence = lifecycleEvidence("callee");
    expect(
      await authorizeRuntimeAction(
        agentInput({
          calleeLifecycleEvidence: {
            ...evidence,
            attestation: { ...evidence.attestation, keyId: "unknown-key" },
          },
        }),
      ),
    ).toMatchObject({
      reason: { type: "attestation_key_unknown", evidenceKind: "callee_lifecycle" },
    });
    expect(
      await authorizeRuntimeAction(
        agentInput({ calleeLifecycleEvidence: mutateSignature(evidence) }),
      ),
    ).toMatchObject({ reason: { type: "attestation_invalid", evidenceKind: "callee_lifecycle" } });
  });

  it.each([
    { specId: "spec-other" },
    { versionOrChannel: "stable" },
  ])("blocks exact opaque callee subject mismatch: %o", async (overrides) => {
    expect(
      await authorizeRuntimeAction(
        agentInput({ calleeLifecycleEvidence: lifecycleEvidence("callee", overrides) }),
      ),
    ).toEqual({
      outcome: "blocked",
      reason: {
        type: "lifecycle_evidence_subject_mismatch",
        role: "callee",
        specId: "spec-web-search",
        versionOrChannel: "1.0.0",
      },
    });
  });

  const nonCallableStates = LifecycleStateSchema.options.filter(
    (state) => !CALLEE_CALLABLE_STATES.some((callableState) => callableState === state),
  );

  it("keeps callee callability distinct and limited to deployed", async () => {
    expect(CALLEE_CALLABLE_STATES).toEqual(["deployed"]);
    expect(nonCallableStates).toEqual([
      "draft",
      "in_review",
      "approved",
      "suspended",
      "revoked",
      "rejected",
    ]);
  });

  it.each(nonCallableStates)("blocks signed callee state `%s` as not callable", async (state) => {
    expect(
      await authorizeRuntimeAction(
        agentInput({ calleeLifecycleEvidence: lifecycleEvidence("callee", { state }) }),
      ),
    ).toEqual({
      outcome: "blocked",
      reason: {
        type: "callee_state_not_callable",
        calleeSpecId: "spec-web-search",
        calleeVersionOrChannel: "1.0.0",
        state,
      },
    });
  });

  it("checks callee state before freshness and freshness before depth or budget", async () => {
    expect(
      await authorizeRuntimeAction(
        agentInput({
          calleeLifecycleEvidence: lifecycleEvidence("callee", {
            state: "revoked",
            assertedAt: "2026-07-23T10:00:00Z",
          }),
          runContextEvidence: runContextEvidence(runtimeSpec, {
            callContext: callContext({ remainingDepth: 0, remainingCallBudget: 0 }),
          }),
        }),
      ),
    ).toMatchObject({ reason: { type: "callee_state_not_callable" } });

    expect(
      await authorizeRuntimeAction(
        agentInput({
          calleeLifecycleEvidence: lifecycleEvidence("callee", {
            assertedAt: "2026-07-23T10:00:00Z",
          }),
          runContextEvidence: runContextEvidence(runtimeSpec, {
            callContext: callContext({ remainingDepth: 0, remainingCallBudget: 0 }),
          }),
        }),
      ),
    ).toMatchObject({
      reason: { type: "lifecycle_evidence_not_fresh", role: "callee", condition: "expired" },
    });
  });

  it("uses half-open callee freshness with no future skew grace", async () => {
    const evidence = lifecycleEvidence("callee", {
      assertedAt: "2026-07-23T13:00:00Z",
      freshnessTtl: 300,
    });
    expect(
      await authorizeRuntimeAction(
        agentInput({
          actingLifecycleEvidence: lifecycleEvidence("acting", {
            assertedAt: "2026-07-23T12:59:00Z",
          }),
          calleeLifecycleEvidence: evidence,
        }),
        { authorizationTime: "2026-07-23T12:59:59.999Z" },
      ),
    ).toMatchObject({
      reason: { type: "lifecycle_evidence_not_fresh", role: "callee", condition: "from_future" },
    });
    expect(
      await authorizeRuntimeAction(
        agentInput({
          actingLifecycleEvidence: lifecycleEvidence("acting", {
            assertedAt: "2026-07-23T13:00:00Z",
          }),
          calleeLifecycleEvidence: evidence,
          runContextEvidence: runContextEvidence(runtimeSpec, {
            assertedAt: "2026-07-23T13:00:00Z",
          }),
          attestedEdgeApprovals: [
            edgeApproval({}, {}, { assertedAt: "2026-07-23T13:00:00Z" }),
          ],
        }),
        { authorizationTime: "2026-07-23T13:04:59.999Z" },
      ),
    ).toMatchObject({ outcome: "allowed" });
    expect(
      await authorizeRuntimeAction(
        agentInput({
          actingLifecycleEvidence: lifecycleEvidence("acting", {
            assertedAt: "2026-07-23T13:04:00Z",
          }),
          calleeLifecycleEvidence: evidence,
          runContextEvidence: runContextEvidence(runtimeSpec, {
            assertedAt: "2026-07-23T13:04:00Z",
          }),
          attestedEdgeApprovals: [
            edgeApproval({}, {}, { assertedAt: "2026-07-23T13:04:00Z" }),
          ],
        }),
        { authorizationTime: "2026-07-23T13:05:00Z" },
      ),
    ).toMatchObject({
      reason: { type: "lifecycle_evidence_not_fresh", role: "callee", condition: "expired" },
    });
  });

  it("rejects an acting-domain signature replayed as callee evidence", async () => {
    const payload = lifecycleEvidence("callee").payload;
    expect(
      await authorizeRuntimeAction(
        agentInput({ calleeLifecycleEvidence: attestLifecycle(payload, "acting") }),
      ),
    ).toMatchObject({
      reason: { type: "attestation_invalid", evidenceKind: "callee_lifecycle" },
    });
  });

  it("preserves declaration, edge currency, human-gate, intent, and cycle precedence", async () => {
    const invalidCallee = mutateSignature(lifecycleEvidence("callee"));
    expect(
      await authorizeRuntimeAction(
        agentInput({
          action: { ...agentAction, calleeSpecId: SpecIdSchema.parse("spec-billing") },
          calleeLifecycleEvidence: invalidCallee,
        }),
      ),
    ).toMatchObject({ reason: { type: "agent_call_not_declared" } });
    expect(
      await authorizeRuntimeAction(agentInput({ attestedEdgeApprovals: [], calleeLifecycleEvidence: invalidCallee })),
    ).toMatchObject({ reason: { type: "call_edge_not_approved" } });
    expect(
      await authorizeRuntimeAction(
        agentInput({
          attestedEdgeApprovals: [
            edgeApproval({ requiresHumanGate: true }),
            edgeApproval({ requiresHumanGate: false }),
          ],
          calleeLifecycleEvidence: invalidCallee,
        }),
      ),
    ).toMatchObject({ reason: { type: "human_gate_required" } });
    expect(
      await authorizeRuntimeAction(
        agentInput({
          attestedEdgeApprovals: [edgeApproval(), edgeApproval({ maxCallsPerRun: 2 })],
          calleeLifecycleEvidence: invalidCallee,
        }),
      ),
    ).toMatchObject({
      reason: { type: "attestation_invalid", evidenceKind: "callee_lifecycle" },
    });
    expect(
      await authorizeRuntimeAction(
        agentInput({
          attestedEdgeApprovals: [edgeApproval({ allowedIntents: ["delegate"] })],
          calleeLifecycleEvidence: invalidCallee,
        }),
      ),
    ).toMatchObject({ reason: { type: "call_intent_not_allowed" } });
    expect(
      await authorizeRuntimeAction(
        agentInput({
          runContextEvidence: runContextEvidence(runtimeSpec, {
            callContext: callContext({
              callChain: ["spec-web-search", "spec-crm-enricher"],
            }),
          }),
          calleeLifecycleEvidence: invalidCallee,
        }),
      ),
    ).toMatchObject({ reason: { type: "cycle_detected" } });
  });

  it("preserves depth, call-budget, and child-budget enforcement", async () => {
    expect(
      await authorizeRuntimeAction(
        agentInput({
          runContextEvidence: runContextEvidence(runtimeSpec, {
            callContext: callContext({ remainingDepth: 0 }),
          }),
        }),
      ),
    ).toMatchObject({ reason: { type: "depth_exhausted" } });
    expect(
      await authorizeRuntimeAction(
        agentInput({
          runContextEvidence: runContextEvidence(runtimeSpec, {
            callContext: callContext({ remainingCallBudget: 0 }),
          }),
        }),
      ),
    ).toMatchObject({ reason: { type: "call_budget_exhausted" } });
    expect(
      await authorizeRuntimeAction(
        agentInput({
          action: {
            ...agentAction,
            childBudget: { callBudget: 4, tokenBudget: 25_000, timeBudget: 40_000 },
          },
        }),
      ),
    ).toMatchObject({ reason: { type: "budget_increase_forbidden" } });
  });

  it("treats a channel as an exact opaque signed subject key", async () => {
    const stableSpec = specFixture({
      declaredAgentCalls: [
        {
          ...(runtimeSpec.declaredAgentCalls[0] as object),
          calleeVersionOrChannel: "stable",
        },
      ],
    });
    const stableAction = { ...agentAction, calleeVersionOrChannel: "stable" };
    expect(
      await authorizeRuntimeAction(
        agentInput({
          spec: stableSpec,
          runtimeBindingEvidence: runtimeBindingEvidence(stableSpec),
          actingLifecycleEvidence: lifecycleEvidence("acting", {
            specId: stableSpec.specId,
            versionOrChannel: stableSpec.version,
          }),
          action: stableAction,
          attestedEdgeApprovals: [edgeApproval({ calleeVersionOrChannel: "stable" })],
          calleeLifecycleEvidence: lifecycleEvidence("callee", {
            versionOrChannel: "stable",
          }),
        }),
      ),
    ).toMatchObject({ outcome: "allowed", actionType: "agent_call" });
  });
});

describe("authorizeRuntimeAction purity", () => {
  it("is deterministic and mutates neither evidence, keyset, spec, nor call context", async () => {
    const input = agentInput();
    const context = structuredClone(authorizationContext);
    const inputSnapshot = structuredClone(input);
    const contextSnapshot = structuredClone(context);

    const first = await authorizeRuntimeActionWithContext(input, context);
    const second = await authorizeRuntimeActionWithContext(input, context);

    expect(first).toEqual(second);
    expect(input).toEqual(inputSnapshot);
    expect(context).toEqual(contextSnapshot);
  });
});

describe("authorizeRuntimeAction Step 14 canonical edge authority", () => {
  function foundResolverFor(
    evidence: AttestedCallGraphEdgeApproval,
    status: "active" | "revoked" = "active",
  ): CanonicalEdgeAuthorityResolver {
    return async (request) => ({
      kind: "found",
      subject: request.subject,
      asOf: request.asOf,
      observedAt: request.asOf,
      record: {
        subject: request.subject,
        authorityRevision: status === "active" ? 3 : 4,
        approvalDigest: computeCallGraphEdgeApprovalDecisionDigest(
          evidence.payload.approval,
        ),
        status,
      },
    });
  }

  it("binds a valid timeout policy at construction and rejects invalid policies", () => {
    const resolver: CanonicalEdgeAuthorityResolver = async () => ({
      kind: "unavailable",
      condition: "resolver_error",
    });
    expect(() =>
      createRuntimeAuthorizer({
        canonicalAuthorityResolver: resolver,
        timeoutPolicy: { timeoutMs: 1 },
        authorizationReservationAdapter: defaultAuthorizationReservationAdapter,
        authorizationReservationTimeoutPolicy: { timeoutMs: 1 },
      }),
    ).not.toThrow();
    for (const timeoutMs of [0, 1.5, 2_147_483_648]) {
      expect(() =>
        createRuntimeAuthorizer({
          canonicalAuthorityResolver: resolver,
          timeoutPolicy: { timeoutMs },
          authorizationReservationAdapter: defaultAuthorizationReservationAdapter,
          authorizationReservationTimeoutPolicy: { timeoutMs: 1 },
        }),
      ).toThrow(TypeError);
    }
  });

  it("performs no lookup for tool calls, rejected-only history, or Step-13 failures", async () => {
    const resolver = vi.fn<CanonicalEdgeAuthorityResolver>(async () => {
      throw new Error("must not be called");
    });

    expect(await authorizeRuntimeAction(baseInput(), {}, resolver)).toEqual({
      outcome: "allowed",
      actionType: "tool_call",
    });
    expect(
      await authorizeRuntimeAction(
        agentInput({
          attestedEdgeApprovals: [
            edgeApproval({}, { decision: "rejected", reason: "denied" }),
          ],
        }),
        {},
        resolver,
      ),
    ).toMatchObject({ reason: { type: "call_edge_not_approved" } });
    expect(
      await authorizeRuntimeAction(
        agentInput({
          attestedEdgeApprovals: [
            edgeApproval(
              {},
              { decision: "rejected", reason: "denied" },
              { assertedAt: "2026-07-23T12:00:00Z", freshnessTtl: 1 },
            ),
            edgeApproval(),
          ],
        }),
        {},
        resolver,
      ),
    ).toMatchObject({
      reason: { type: "call_graph_edge_approval_not_fresh", condition: "expired" },
    });
    expect(resolver).not.toHaveBeenCalled();
  });

  it("performs one exact-subject lookup as of the trusted authorization time", async () => {
    const current = edgeApproval();
    const resolver = vi.fn<CanonicalEdgeAuthorityResolver>(foundResolverFor(current));
    const asOf = "2026-07-23T15:00:00+02:00";

    expect(
      await authorizeRuntimeAction(
        agentInputWithFreshSupportingEvidence(asOf, [
          edgeApproval({}, {}, { assertedAt: asOf }),
        ]),
        { authorizationTime: asOf },
        resolver,
      ),
    ).toMatchObject({ outcome: "allowed", actionType: "agent_call" });
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver).toHaveBeenCalledWith({
      subject: {
        callerSpecId: "spec-crm-enricher",
        callerVersion: "1.0.0",
        calleeSpecId: "spec-web-search",
        calleeVersionOrChannel: "1.0.0",
        trustDomainId: "domain-sales",
      },
      asOf,
    });
  });

  it("distinguishes subject absence, supersession, and revocation", async () => {
    const current = edgeApproval({}, { artifactId: "approval-current" });
    const presented = edgeApproval({}, { artifactId: "approval-presented" });

    const subjectAbsent: CanonicalEdgeAuthorityResolver = async (request) => ({
      kind: "subject_absent",
      subject: request.subject,
      asOf: request.asOf,
      observedAt: request.asOf,
    });
    expect(
      await authorizeRuntimeAction(
        agentInput({ attestedEdgeApprovals: [presented] }),
        {},
        subjectAbsent,
      ),
    ).toEqual({
      outcome: "blocked",
      reason: {
        type: "call_graph_edge_approval_not_current",
        condition: "subject_absent",
      },
    });

    expect(
      await authorizeRuntimeAction(
        agentInput({ attestedEdgeApprovals: [presented] }),
        {},
        foundResolverFor(current),
      ),
    ).toEqual({
      outcome: "blocked",
      reason: {
        type: "call_graph_edge_approval_not_current",
        condition: "authority_superseded",
      },
    });

    expect(
      await authorizeRuntimeAction(
        agentInput({
          attestedEdgeApprovals: [current],
          calleeLifecycleEvidence: mutateSignature(lifecycleEvidence("callee")),
        }),
        {},
        foundResolverFor(current, "revoked"),
      ),
    ).toEqual({
      outcome: "blocked",
      reason: { type: "call_graph_edge_approval_revoked" },
    });
  });

  it("selects the lease-fresh canonical decision independent of presentation order", async () => {
    const superseded = edgeApproval(
      { maxCallsPerRun: 2 },
      { artifactId: "approval-superseded" },
    );
    const current = edgeApproval(
      { maxCallsPerRun: 3 },
      { artifactId: "approval-current" },
    );
    const resolver = foundResolverFor(current);

    for (const approvals of [
      [superseded, current],
      [current, superseded],
    ]) {
      expect(
        await authorizeRuntimeAction(
          agentInput({ attestedEdgeApprovals: approvals }),
          {},
          resolver,
        ),
      ).toMatchObject({ outcome: "allowed", actionType: "agent_call" });
    }
  });

  it("maps malformed or misbound lookup observations to response_untrustworthy", async () => {
    const current = edgeApproval();
    const cases: CanonicalEdgeAuthorityResolver[] = [
      async (request) => ({
        ...(await foundResolverFor(current)(request) as object),
        extra: true,
      }),
      async (request) => ({
        ...(await foundResolverFor(current)(request) as object),
        asOf: "2026-07-23T12:59:59.999Z",
      }),
      async (request) => ({
        ...(await foundResolverFor(current)(request) as object),
        observedAt: "2026-07-23T12:59:59.999Z",
      }),
      async (request) => ({
        ...(await foundResolverFor(current)(request) as object),
        subject: { ...request.subject, callerVersion: "2.0.0" },
      }),
    ];

    for (const resolver of cases) {
      expect(
        await authorizeRuntimeAction(
          agentInput({ attestedEdgeApprovals: [current] }),
          {},
          resolver,
        ),
      ).toEqual({
        outcome: "blocked",
        reason: {
          type: "approval_authority_lookup_unavailable",
          condition: "response_untrustworthy",
        },
      });
    }
  });

  it("preserves closed unavailable conditions and maps resolver failures", async () => {
    const current = edgeApproval();
    for (const condition of [
      "timeout",
      "resolver_error",
      "response_untrustworthy",
    ] as const) {
      expect(
        await authorizeRuntimeAction(
          agentInput({ attestedEdgeApprovals: [current] }),
          {},
          async () => ({ kind: "unavailable", condition }),
        ),
      ).toEqual({
        outcome: "blocked",
        reason: { type: "approval_authority_lookup_unavailable", condition },
      });
    }

    expect(
      await authorizeRuntimeAction(
        agentInput({ attestedEdgeApprovals: [current] }),
        {},
        async () => {
          throw new Error("private resolver detail");
        },
      ),
    ).toEqual({
      outcome: "blocked",
      reason: {
        type: "approval_authority_lookup_unavailable",
        condition: "resolver_error",
      },
    });
  });

  it("fails closed on resolver timeout without retry or fallback", async () => {
    vi.useFakeTimers();
    try {
      const current = edgeApproval();
      const resolver = vi.fn<CanonicalEdgeAuthorityResolver>(
        () => new Promise(() => undefined),
      );
      const authorizer = createRuntimeAuthorizer({
        canonicalAuthorityResolver: resolver,
        timeoutPolicy: { timeoutMs: 10 },
        authorizationReservationAdapter: defaultAuthorizationReservationAdapter,
        authorizationReservationTimeoutPolicy: { timeoutMs: 10 },
      });
      const result = authorizer.authorizeRuntimeAction(
        agentInput({ attestedEdgeApprovals: [current] }),
        authorizationContext,
      );
      await vi.advanceTimersByTimeAsync(10);
      await expect(result).resolves.toEqual({
        outcome: "blocked",
        reason: {
          type: "approval_authority_lookup_unavailable",
          condition: "timeout",
        },
      });
      expect(resolver).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("authorizeRuntimeAction Step 15 agent-call authorization reservation", () => {
  function reservedResult(
    request: AgentCallAuthorizationReservationRequestV1,
    kind: "reserved" | "already_reserved" = "reserved",
  ) {
    return {
      kind,
      receipt: {
        ...request,
        reservedAt: request.authorizationTime,
      },
    };
  }

  it("binds the host reservation adapter and its strict timeout policy at construction", () => {
    const input = agentInput();
    const resolver = defaultCanonicalAuthorityResolver(input);
    expect(() =>
      createRuntimeAuthorizer({
        canonicalAuthorityResolver: resolver,
        timeoutPolicy: { timeoutMs: 1 },
        authorizationReservationAdapter: defaultAuthorizationReservationAdapter,
        authorizationReservationTimeoutPolicy: { timeoutMs: 1 },
      }),
    ).not.toThrow();

    expect(() =>
      createRuntimeAuthorizer({
        canonicalAuthorityResolver: resolver,
        timeoutPolicy: { timeoutMs: 1 },
        authorizationReservationAdapter: undefined as unknown as AgentCallAuthorizationReservationAdapter,
        authorizationReservationTimeoutPolicy: { timeoutMs: 1 },
      }),
    ).toThrow(TypeError);

    for (const timeoutMs of [0, 1.5, 2_147_483_648]) {
      expect(() =>
        createRuntimeAuthorizer({
          canonicalAuthorityResolver: resolver,
          timeoutPolicy: { timeoutMs: 1 },
          authorizationReservationAdapter: defaultAuthorizationReservationAdapter,
          authorizationReservationTimeoutPolicy: { timeoutMs },
        }),
      ).toThrow(TypeError);
    }
  });

  it("performs exactly one final reservation with the complete deterministic binding", async () => {
    const input = agentInput();
    const resolver = vi.fn<CanonicalEdgeAuthorityResolver>(
      defaultCanonicalAuthorityResolver(input),
    );
    const adapter = vi.fn<AgentCallAuthorizationReservationAdapter>(async (request) =>
      reservedResult(request),
    );

    const result = await authorizeWithReservationAdapter(input, adapter, {}, resolver);
    expect(result).toMatchObject({
      outcome: "allowed",
      actionType: "agent_call",
      childRunContextDraft: {
        calleeSpecId: "spec-web-search",
        callContext: { parentRunId: "run-current" },
      },
      localAuthorizationReservationReceipt: {
        currentRunId: "run-current",
        expectedAuthorityRevision: 1,
        authorizationTime: authorizationContext.authorizationTime,
        authorizationValidUntilExclusive: "2026-07-23T13:04:00.000Z",
      },
    });
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(adapter).toHaveBeenCalledTimes(1);

    const request = adapter.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      subject: {
        callerSpecId: "spec-crm-enricher",
        callerVersion: "1.0.0",
        calleeSpecId: "spec-web-search",
        calleeVersionOrChannel: "1.0.0",
        trustDomainId: "domain-sales",
      },
      expectedAuthorityRevision: 1,
      currentRunId: "run-current",
      authorizationTime: "2026-07-23T13:00:00Z",
      authorizationValidUntilExclusive: "2026-07-23T13:04:00.000Z",
    });
    for (const digest of [
      request?.reservationId,
      request?.expectedApprovalDigest,
      request?.runContextDigest,
      request?.actionDigest,
      request?.childRunContextDraftDigest,
    ]) {
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("uses the freshest canonical-matching approval lease without array-order selection", async () => {
    const olderLease = edgeApproval({}, {}, {
      assertedAt: "2026-07-23T12:58:00Z",
      freshnessTtl: 300,
    });
    const newerLease = edgeApproval({}, {}, {
      assertedAt: "2026-07-23T12:59:00Z",
      freshnessTtl: 300,
    });
    const requests: AgentCallAuthorizationReservationRequestV1[] = [];
    const adapter: AgentCallAuthorizationReservationAdapter = async (request) => {
      requests.push(request);
      return reservedResult(request);
    };

    for (const approvals of [
      [olderLease, newerLease],
      [newerLease, olderLease],
    ]) {
      const input = agentInputWithFreshSupportingEvidence("2026-07-23T13:00:00Z", approvals);
      expect(
        await authorizeWithReservationAdapter(input, adapter),
      ).toMatchObject({ outcome: "allowed" });
    }

    expect(requests).toHaveLength(2);
    expect(requests[0]?.authorizationValidUntilExclusive).toBe(
      "2026-07-23T13:04:00.000Z",
    );
    expect(requests[1]).toEqual(requests[0]);
  });

  it("never reserves tool calls or agent calls blocked by any earlier pure guard", async () => {
    const adapter = vi.fn<AgentCallAuthorizationReservationAdapter>(async () => {
      throw new Error("must not be called");
    });

    expect(await authorizeWithReservationAdapter(baseInput(), adapter)).toEqual({
      outcome: "allowed",
      actionType: "tool_call",
    });

    for (const input of [
      agentInput({ attestedEdgeApprovals: [] }),
      agentInput({ attestedEdgeApprovals: [edgeApproval({ requiresHumanGate: true })] }),
      agentInput({ attestedEdgeApprovals: [edgeApproval({ allowedIntents: ["delegate"] })] }),
      agentInput({ calleeLifecycleEvidence: mutateSignature(lifecycleEvidence("callee")) }),
      agentInput({
        runContextEvidence: runContextEvidence(runtimeSpec, {
          callContext: callContext({ remainingDepth: 0 }),
        }),
      }),
      agentInput({
        action: {
          ...agentAction,
          childBudget: { callBudget: 4, tokenBudget: 5_000, timeBudget: 10_000 },
        },
      }),
    ]) {
      expect((await authorizeWithReservationAdapter(input, adapter)).outcome).toBe("blocked");
    }
    const current = edgeApproval();
    const revokedAtAdmission: CanonicalEdgeAuthorityResolver = async (request) => ({
      kind: "found",
      subject: request.subject,
      asOf: request.asOf,
      observedAt: request.asOf,
      record: {
        subject: request.subject,
        authorityRevision: 2,
        approvalDigest: computeCallGraphEdgeApprovalDecisionDigest(current.payload.approval),
        status: "revoked",
      },
    });
    expect(
      await authorizeWithReservationAdapter(
        agentInput({ attestedEdgeApprovals: [current] }),
        adapter,
        {},
        revokedAtAdmission,
      ),
    ).toMatchObject({ reason: { type: "call_graph_edge_approval_revoked" } });
    expect(adapter).not.toHaveBeenCalled();
  });

  it("maps final authority, deadline, and store outcomes with deterministic reasons", async () => {
    const cases: Array<{
      result: (request: AgentCallAuthorizationReservationRequestV1) => unknown;
      expected: object;
    }> = [
      {
        result: (request) => ({ kind: "subject_absent", observedAt: request.authorizationTime }),
        expected: {
          type: "agent_call_authorization_reservation_not_current",
          condition: "subject_absent",
        },
      },
      {
        result: (request) => ({
          kind: "authority_revoked",
          observedAt: request.authorizationTime,
          currentAuthorityRevision: request.expectedAuthorityRevision + 1,
        }),
        expected: { type: "agent_call_authorization_reservation_revoked" },
      },
      {
        result: (request) => ({
          kind: "authority_superseded",
          observedAt: request.authorizationTime,
          currentAuthorityRevision: request.expectedAuthorityRevision + 1,
          currentApprovalDigest: "f".repeat(64),
        }),
        expected: {
          type: "agent_call_authorization_reservation_not_current",
          condition: "authority_superseded",
        },
      },
      {
        result: (request) => ({
          kind: "authorization_window_expired",
          observedAt: request.authorizationValidUntilExclusive,
        }),
        expected: { type: "agent_call_authorization_reservation_window_expired" },
      },
      {
        result: () => ({ kind: "unavailable", condition: "store_error" }),
        expected: {
          type: "agent_call_authorization_reservation_indeterminate",
          condition: "store_error",
        },
      },
    ];

    for (const testCase of cases) {
      const adapter: AgentCallAuthorizationReservationAdapter = async (request) =>
        testCase.result(request);
      expect(
        await authorizeWithReservationAdapter(agentInput(), adapter),
      ).toEqual({ outcome: "blocked", reason: testCase.expected });
    }
  });

  it("accepts an exact already-reserved retry and rejects receipt or observation drift", async () => {
    const exactRetry: AgentCallAuthorizationReservationAdapter = async (request) =>
      reservedResult(request, "already_reserved");
    expect(
      await authorizeWithReservationAdapter(agentInput(), exactRetry),
    ).toMatchObject({
      outcome: "allowed",
      actionType: "agent_call",
      localAuthorizationReservationReceipt: {
        authorizationTime: authorizationContext.authorizationTime,
      },
    });

    const untrustworthyCases: AgentCallAuthorizationReservationAdapter[] = [
      async (request) => ({ ...reservedResult(request), extra: true }),
      async (request) => ({
        ...reservedResult(request),
        receipt: { ...reservedResult(request).receipt, reservationId: "0".repeat(64) },
      }),
      async (request) => ({
        ...reservedResult(request),
        receipt: {
          ...reservedResult(request).receipt,
          reservedAt: request.authorizationValidUntilExclusive,
        },
      }),
      async (request) => ({
        kind: "subject_absent",
        observedAt: "2026-07-23T12:59:59.999Z",
      }),
      async (request) => ({
        kind: "authority_revoked",
        observedAt: request.authorizationTime,
        currentAuthorityRevision: request.expectedAuthorityRevision,
      }),
      async (request) => ({
        kind: "authority_superseded",
        observedAt: request.authorizationTime,
        currentAuthorityRevision: request.expectedAuthorityRevision - 1,
        currentApprovalDigest: request.expectedApprovalDigest,
      }),
      async (request) => ({
        kind: "authorization_window_expired",
        observedAt: request.authorizationTime,
      }),
    ];

    for (const adapter of untrustworthyCases) {
      expect(
        await authorizeWithReservationAdapter(agentInput(), adapter),
      ).toEqual({
        outcome: "blocked",
        reason: {
          type: "agent_call_authorization_reservation_indeterminate",
          condition: "response_untrustworthy",
        },
      });
    }
  });

  it("maps adapter exceptions and timeout as indeterminate without retry", async () => {
    expect(
      await authorizeWithReservationAdapter(agentInput(), async () => {
        throw new Error("private adapter detail");
      }),
    ).toEqual({
      outcome: "blocked",
      reason: {
        type: "agent_call_authorization_reservation_indeterminate",
        condition: "adapter_error",
      },
    });

    vi.useFakeTimers();
    try {
      const input = agentInput();
      const adapter = vi.fn<AgentCallAuthorizationReservationAdapter>(
        () => new Promise(() => undefined),
      );
      const authorizer = createRuntimeAuthorizer({
        canonicalAuthorityResolver: defaultCanonicalAuthorityResolver(input),
        timeoutPolicy: { timeoutMs: 10 },
        authorizationReservationAdapter: adapter,
        authorizationReservationTimeoutPolicy: { timeoutMs: 10 },
      });
      const pending = authorizer.authorizeRuntimeAction(input, authorizationContext);
      await vi.advanceTimersByTimeAsync(10);
      await expect(pending).resolves.toEqual({
        outcome: "blocked",
        reason: {
          type: "agent_call_authorization_reservation_indeterminate",
          condition: "timeout",
        },
      });
      expect(adapter).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

import { describe, expect, it } from "vitest";
import { computeContentHash } from "../../src/assembler/content-hash.js";
import {
  CALLEE_CALLABLE_STATES,
  RUNTIME_EXECUTABLE_STATES,
  authorizeRuntimeAction as authorizeRuntimeActionWithContext,
} from "../../src/runtime/authorize-runtime-action.js";
import { DecidedCallGraphEdgeApprovalSchema } from "../../src/schema/approval-artifact.js";
import { AgentSpecContentSchema, type AgentSpecContent } from "../../src/schema/agent-spec-content.js";
import { LifecycleStateSchema } from "../../src/schema/agent-spec-runtime-metadata.js";
import { CallContextSchema, type CallContext } from "../../src/schema/call-context.js";
import { SpecIdSchema } from "../../src/schema/common.js";
import {
  AgentLifecycleEvidencePayloadSchema,
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

function authorizeRuntimeAction(
  input: RuntimeAuthorizationInput,
  overrides: Partial<TrustedRuntimeAuthorizationContext> = {},
) {
  return authorizeRuntimeActionWithContext(input, {
    ...authorizationContext,
    ...overrides,
  });
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
): AttestedCallGraphEdgeApproval {
  const payload = DecidedCallGraphEdgeApprovalSchema.parse({
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
  it("allows an exact declared tool call with attested binding and acting lifecycle evidence", () => {
    expect(authorizeRuntimeAction(baseInput())).toEqual({
      outcome: "allowed",
      actionType: "tool_call",
    });
  });

  it("fails input validation before trusted-context validation", () => {
    const valid = baseInput();
    const input = {
      ...valid,
      runContextEvidence: {
        ...valid.runContextEvidence,
        payload: { ...valid.runContextEvidence.payload, currentRunId: "" },
      },
    } as RuntimeAuthorizationInput;
    expect(
      authorizeRuntimeActionWithContext(input, {
        authorizationTime: "not-a-time",
        attestationKeys: [],
      } as TrustedRuntimeAuthorizationContext),
    ).toEqual({
      outcome: "blocked",
      reason: { type: "input_invalid", reason: "schema_validation_failed" },
    });
  });

  it("requires the trusted context and rejects malformed or duplicate keysets", () => {
    // @ts-expect-error Trusted authorization time and keyset are mandatory.
    expect(authorizeRuntimeActionWithContext(baseInput())).toEqual({
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
        authorizeRuntimeActionWithContext(
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

  it("rejects legacy mutable runtime metadata at the strict input boundary", () => {
    const input = {
      ...baseInput(),
      metadata: { specId: runtimeSpec.specId, version: runtimeSpec.version, state: "deployed" },
    } as unknown as RuntimeAuthorizationInput;
    expect(authorizeRuntimeAction(input)).toEqual({
      outcome: "blocked",
      reason: { type: "input_invalid", reason: "schema_validation_failed" },
    });
  });

  it("requires acting lifecycle evidence structurally for every action", () => {
    const { actingLifecycleEvidence: _ignored, ...input } = baseInput();
    expect(
      authorizeRuntimeAction(input as RuntimeAuthorizationInput),
    ).toEqual({
      outcome: "blocked",
      reason: { type: "input_invalid", reason: "schema_validation_failed" },
    });
  });

  it("blocks missing runtime binding evidence before acting lifecycle evaluation", () => {
    expect(
      authorizeRuntimeAction(
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
  ] as const)("blocks unknown keys for %s evidence before signature verification", (evidenceKind, field) => {
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
    expect(authorizeRuntimeAction(baseInput({ [field]: evidence }))).toEqual({
      outcome: "blocked",
      reason: { type: "attestation_key_unknown", evidenceKind, keyId: "unknown-key" },
    });
  });

  it.each(["runtime_binding", "acting_lifecycle"] as const)(
    "treats a trusted key without `%s` authority as unknown for that evidence kind",
    (evidenceKind) => {
      expect(
        authorizeRuntimeActionWithContext(
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
  ] as const)("blocks invalid signatures for %s evidence", (evidenceKind, field) => {
    const evidence =
      field === "runtimeBindingEvidence"
        ? mutateSignature(runtimeBindingEvidence())
        : mutateSignature(lifecycleEvidence("acting"));
    expect(authorizeRuntimeAction(baseInput({ [field]: evidence }))).toEqual({
      outcome: "blocked",
      reason: { type: "attestation_invalid", evidenceKind, keyId: TEST_ATTESTATION_KEY_ID },
    });
  });

  it("treats a keyId switched to another trusted key as an invalid signature", () => {
    const evidence = runtimeBindingEvidence();
    expect(
      authorizeRuntimeAction(
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

  it("verifies binding signatures before artifact subject, hash, and lease guards", () => {
    const evidence = runtimeBindingEvidence(runtimeSpec, {
      specId: "spec-other",
      contentHash: "wrong-hash",
      deployedAt: "2026-07-23T10:00:00Z",
      ttl: 1,
    });
    expect(
      authorizeRuntimeAction(
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
  ])("re-sources runtime subject mismatch to the attested artifact: %o", (overrides) => {
    expect(
      authorizeRuntimeAction(
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

  it("blocks a self-inconsistent presented spec contentHash", () => {
    const spec = AgentSpecContentSchema.parse({ ...runtimeSpec, contentHash: "self-inconsistent" });
    expect(
      authorizeRuntimeAction(
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

  it("blocks a validly signed artifact whose contentHash differs from recomputed spec content", () => {
    expect(
      authorizeRuntimeAction(
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

  it("blocks when recomputed content matches the artifact but not the presented spec hash", () => {
    const selfInconsistentSpec = AgentSpecContentSchema.parse({
      ...runtimeSpec,
      contentHash: "presented-spec-hash-is-wrong",
    });
    expect(
      authorizeRuntimeAction(
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

  it("detects spec-content mutation even when the presented hashes remain unchanged", () => {
    const mutatedSpec = AgentSpecContentSchema.parse({
      ...runtimeSpec,
      objective: "Tampered objective",
    });
    expect(
      authorizeRuntimeAction(
        baseInput({
          spec: mutatedSpec,
          runtimeBindingEvidence: runtimeBindingEvidence(mutatedSpec, {
            contentHash: runtimeSpec.contentHash,
          }),
        }),
      ),
    ).toMatchObject({ reason: { type: "runtime_binding_content_hash_mismatch" } });
  });

  it("evaluates the attested binding over the Step-8 half-open lease", () => {
    const offsetBinding = runtimeBindingEvidence(runtimeSpec, {
      deployedAt: "2026-07-23T14:30:00+02:00",
    });
    expect(
      authorizeRuntimeAction(
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
      authorizeRuntimeAction(baseInput(), { authorizationTime: "2026-07-23T12:29:59.999Z" }),
    ).toMatchObject({ reason: { type: "runtime_binding_not_yet_valid" } });
    expect(
      authorizeRuntimeAction(
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
      authorizeRuntimeAction(baseInput(), { authorizationTime: "2026-07-23T13:30:00Z" }),
    ).toMatchObject({ reason: { type: "runtime_binding_expired" } });
  });

  it("lets content-hash failure beat expiry and expiry beat acting lifecycle", () => {
    expect(
      authorizeRuntimeAction(
        baseInput({
          runtimeBindingEvidence: runtimeBindingEvidence(runtimeSpec, { contentHash: "wrong" }),
        }),
        { authorizationTime: "2026-07-23T14:00:00Z" },
      ),
    ).toMatchObject({ reason: { type: "runtime_binding_content_hash_mismatch" } });

    expect(
      authorizeRuntimeAction(
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

  it("keeps acting executability distinct and limited to deployed", () => {
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

  it.each(nonExecutableStates)("blocks signed acting state `%s` as non-executable", (state) => {
    expect(
      authorizeRuntimeAction(
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
  ])("blocks acting lifecycle subject mismatch: %o", (overrides) => {
    expect(
      authorizeRuntimeAction(
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

  it("checks acting signature before subject, state, and freshness", () => {
    const evidence = lifecycleEvidence("acting", {
      specId: "spec-other",
      state: "revoked",
      assertedAt: "2026-07-23T14:00:00Z",
    });
    expect(
      authorizeRuntimeAction(baseInput({ actingLifecycleEvidence: mutateSignature(evidence) })),
    ).toMatchObject({ reason: { type: "attestation_invalid", evidenceKind: "acting_lifecycle" } });
  });

  it("rejects a callee-domain signature replayed as acting evidence", () => {
    const payload = AgentLifecycleEvidencePayloadSchema.parse({
      ...lifecycleEvidence("acting").payload,
    });
    expect(
      authorizeRuntimeAction(
        baseInput({ actingLifecycleEvidence: attestLifecycle(payload, "callee") }),
      ),
    ).toMatchObject({
      reason: { type: "attestation_invalid", evidenceKind: "acting_lifecycle" },
    });
  });

  it("treats acting freshness as a half-open interval with no skew grace", () => {
    const assertedAt = "2026-07-23T13:00:00Z";
    const evidence = lifecycleEvidence("acting", { assertedAt, freshnessTtl: 300 });
    const freshRunContext = runContextEvidence(runtimeSpec, { assertedAt, freshnessTtl: 300 });

    expect(
      authorizeRuntimeAction(baseInput({ actingLifecycleEvidence: evidence, runContextEvidence: freshRunContext }), {
        authorizationTime: assertedAt,
      }),
    ).toEqual({ outcome: "allowed", actionType: "tool_call" });
    expect(
      authorizeRuntimeAction(baseInput({ actingLifecycleEvidence: evidence, runContextEvidence: freshRunContext }), {
        authorizationTime: "2026-07-23T12:59:59.999Z",
      }),
    ).toMatchObject({
      reason: { type: "lifecycle_evidence_not_fresh", role: "acting", condition: "from_future" },
    });
    expect(
      authorizeRuntimeAction(baseInput({ actingLifecycleEvidence: evidence, runContextEvidence: freshRunContext }), {
        authorizationTime: "2026-07-23T13:04:59.999Z",
      }),
    ).toEqual({ outcome: "allowed", actionType: "tool_call" });
    expect(
      authorizeRuntimeAction(baseInput({ actingLifecycleEvidence: evidence, runContextEvidence: freshRunContext }), {
        authorizationTime: "2026-07-23T13:05:00Z",
      }),
    ).toMatchObject({
      reason: { type: "lifecycle_evidence_not_fresh", role: "acting", condition: "expired" },
    });
  });

  it("compares lifecycle freshness as absolute instants across offsets", () => {
    expect(
      authorizeRuntimeAction(
        baseInput({
          actingLifecycleEvidence: lifecycleEvidence("acting", {
            assertedAt: "2026-07-23T15:00:00+02:00",
          }),
        }),
        { authorizationTime: "2026-07-23T13:00:00Z" },
      ),
    ).toEqual({ outcome: "allowed", actionType: "tool_call" });
  });

  it("lets non-executable acting state beat invalid freshness", () => {
    expect(
      authorizeRuntimeAction(
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

  it("lets acting freshness beat call-context and action failures", () => {
    expect(
      authorizeRuntimeAction(
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
  it("accepts both valid root and child run topology", () => {
    expect(authorizeRuntimeAction(baseInput())).toEqual({
      outcome: "allowed",
      actionType: "tool_call",
    });
    expect(
      authorizeRuntimeAction(
        baseInput({
          runContextEvidence: runContextEvidence(runtimeSpec, {
            currentRunId: "run-root",
            callContext: callContext({ parentRunId: null }),
          }),
        }),
      ),
    ).toEqual({ outcome: "allowed", actionType: "tool_call" });
  });

  it("maps missing key purpose and invalid signatures to generic attestation reasons", () => {
    expect(
      authorizeRuntimeAction(baseInput(), contextWithoutEvidenceKind("run_context")),
    ).toEqual({
      outcome: "blocked",
      reason: {
        type: "attestation_key_unknown",
        evidenceKind: "run_context",
        keyId: TEST_ATTESTATION_KEY_ID,
      },
    });
    expect(
      authorizeRuntimeAction(
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

  it("rejects a lifecycle-domain signature replayed as run-context evidence", () => {
    const evidence = runContextEvidence();
    expect(
      authorizeRuntimeAction(
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
  ])("binds the signed run context to the exact acting subject: %s", (payloadOverride) => {
    expect(
      authorizeRuntimeAction(
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

  it("isolates cross-trust-domain replay at the run-context content-hash join", () => {
    const domainBSpec = specFixture({ trustDomainId: "domain-operations" });
    expect(domainBSpec.contentHash).not.toBe(runtimeSpec.contentHash);
    expect(
      authorizeRuntimeAction(
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

  it("uses a half-open run-context freshness window with no skew grace", () => {
    const assertedAt = "2026-07-23T13:00:00Z";
    const evidence = runContextEvidence(runtimeSpec, { assertedAt, freshnessTtl: 300 });

    expect(
      authorizeRuntimeAction(
        baseInput({ runContextEvidence: evidence }),
        { authorizationTime: assertedAt },
      ),
    ).toEqual({ outcome: "allowed", actionType: "tool_call" });
    expect(
      authorizeRuntimeAction(
        baseInput({ runContextEvidence: evidence }),
        { authorizationTime: "2026-07-23T12:59:59.999Z" },
      ),
    ).toMatchObject({ reason: { type: "run_context_not_fresh", condition: "from_future" } });
    expect(
      authorizeRuntimeAction(
        baseInput({
          actingLifecycleEvidence: lifecycleEvidence("acting", { assertedAt }),
          runContextEvidence: evidence,
        }),
        { authorizationTime: "2026-07-23T13:04:59.999Z" },
      ),
    ).toEqual({ outcome: "allowed", actionType: "tool_call" });
    expect(
      authorizeRuntimeAction(
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

  it("compares run-context freshness as absolute instants across offsets", () => {
    expect(
      authorizeRuntimeAction(
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
  ] as const)("blocks signed but inconsistent topology: $condition", ({ overrides, condition }) => {
    expect(
      authorizeRuntimeAction(
        baseInput({ runContextEvidence: runContextEvidence(runtimeSpec, overrides) }),
      ),
    ).toEqual({
      outcome: "blocked",
      reason: { type: "run_context_invalid", condition },
    });
  });

  it("pins global and run-context guard precedence before action semantics", () => {
    const invalidTopology = runContextEvidence(runtimeSpec, {
      callContext: callContext({ callChain: ["spec-other"] }),
    });
    expect(
      authorizeRuntimeAction(
        baseInput({ runtimeBindingEvidence: undefined, runContextEvidence: invalidTopology }),
      ),
    ).toMatchObject({ reason: { type: "runtime_binding_missing" } });
    expect(
      authorizeRuntimeAction(
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
      authorizeRuntimeAction(
        baseInput({
          runContextEvidence: forged,
          action: { type: "tool_call", toolId: "email.send", scope: "tenant:acme:crm" },
        }),
      ),
    ).toMatchObject({ reason: { type: "attestation_invalid", evidenceKind: "run_context" } });

    expect(
      authorizeRuntimeAction(
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
      authorizeRuntimeAction(
        baseInput({
          runContextEvidence: runContextEvidence(runtimeSpec, {
            assertedAt: "2026-07-23T12:00:00Z",
            callContext: callContext({ callChain: ["spec-other"] }),
          }),
        }),
      ),
    ).toMatchObject({ reason: { type: "run_context_not_fresh", condition: "expired" } });

    expect(
      authorizeRuntimeAction(
        baseInput({
          runContextEvidence: invalidTopology,
          action: { type: "tool_call", toolId: "email.send", scope: "tenant:acme:crm" },
        }),
      ),
    ).toMatchObject({ reason: { type: "run_context_invalid" } });
  });

  it("is stateless and therefore allows identical sibling presentations deterministically", () => {
    const input = agentInput();
    const first = authorizeRuntimeAction(input);
    const second = authorizeRuntimeAction(input);
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
  it("ignores any structurally valid callee evidence for tool calls", () => {
    const evidence = lifecycleEvidence("callee", {
      specId: "spec-foreign",
      versionOrChannel: "stable",
      state: "revoked",
      assertedAt: "2026-07-23T10:00:00Z",
    });
    expect(
      authorizeRuntimeAction(
        baseInput({
          calleeLifecycleEvidence: {
            ...mutateSignature(evidence),
            attestation: { ...evidence.attestation, keyId: "unknown-key" },
          },
        }),
      ),
    ).toEqual({ outcome: "allowed", actionType: "tool_call" });
  });

  it("rejects structurally invalid callee evidence even for tool calls", () => {
    const input = {
      ...baseInput(),
      calleeLifecycleEvidence: {
        payload: { specId: "spec-web-search", state: "deployed" },
        attestation: { keyId: "x", signatureBase64: "not-base64" },
      },
    } as unknown as RuntimeAuthorizationInput;
    expect(authorizeRuntimeAction(input)).toEqual({
      outcome: "blocked",
      reason: { type: "input_invalid", reason: "schema_validation_failed" },
    });
  });

  it("ignores structurally valid edge evidence for tool calls without inspecting its key or signature", () => {
    const unknownKey = edgeApproval();
    expect(
      authorizeRuntimeAction(
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

  it("rejects structurally invalid edge evidence even for tool calls", () => {
    const input = {
      ...baseInput(),
      attestedEdgeApprovals: [
        {
          payload: { ...edgeApproval().payload, decision: "pending" },
          attestation: edgeApproval().attestation,
        },
      ],
    } as unknown as RuntimeAuthorizationInput;
    expect(authorizeRuntimeAction(input)).toEqual({
      outcome: "blocked",
      reason: { type: "input_invalid", reason: "schema_validation_failed" },
    });
  });

  it("keeps exact tool declaration and scope checks", () => {
    expect(
      authorizeRuntimeAction(
        baseInput({ action: { type: "tool_call", toolId: "email.send", scope: "tenant:acme:crm" } }),
      ),
    ).toEqual({ outcome: "blocked", reason: { type: "tool_not_declared", toolId: "email.send" } });
    expect(
      authorizeRuntimeAction(
        baseInput({ action: { type: "tool_call", toolId: "crm.enrich", scope: "tenant:acme" } }),
      ),
    ).toEqual({
      outcome: "blocked",
      reason: { type: "tool_scope_not_allowed", toolId: "crm.enrich", scope: "tenant:acme" },
    });
  });
});

describe("authorizeRuntimeAction agent calls", () => {
  it("allows an approved agent call and returns an unsigned child run-context draft", () => {
    expect(authorizeRuntimeAction(agentInput())).toEqual({
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

  it.each([
    { callerSpecId: "spec-other" },
    { callerVersion: "9.9.9" },
    { calleeSpecId: "spec-other" },
    { calleeVersionOrChannel: "stable" },
    { trustDomainId: "domain-foreign" },
  ])("treats a five-field edge subject mismatch as irrelevant: %o", (edgeOverrides) => {
    expect(
      authorizeRuntimeAction(
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

  it("never authorizes through tampered join fields", () => {
    const foreign = edgeApproval({ calleeSpecId: "spec-foreign" });
    const tamperedIntoRelevance = {
      ...foreign,
      payload: {
        ...foreign.payload,
        edge: {
          ...foreign.payload.edge,
          calleeSpecId: SpecIdSchema.parse("spec-web-search"),
        },
      },
    };
    expect(
      authorizeRuntimeAction(
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
        edge: {
          ...relevant.payload.edge,
          calleeSpecId: SpecIdSchema.parse("spec-foreign"),
        },
      },
    };
    expect(
      authorizeRuntimeAction(
        agentInput({ attestedEdgeApprovals: [tamperedOutOfRelevance] }),
      ),
    ).toMatchObject({ reason: { type: "call_edge_not_approved" } });
  });

  it("ignores cryptographically invalid irrelevant evidence but verifies every relevant entry", () => {
    const irrelevant = edgeApproval({ calleeSpecId: "spec-foreign" });
    const irrelevantUnknownKey = {
      ...irrelevant,
      attestation: { ...irrelevant.attestation, keyId: "unknown-key" },
    };
    expect(
      authorizeRuntimeAction(
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
      authorizeRuntimeAction(
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

  it("uses input order for relevant attestation failures before decision filtering", () => {
    const unknownKey = edgeApproval({}, { decision: "rejected", reason: "denied" });
    const withUnknownKey = {
      ...unknownKey,
      attestation: { ...unknownKey.attestation, keyId: "unknown-key" },
    };
    const invalidSignature = mutateSignature(
      edgeApproval({}, { decision: "rejected", reason: "denied" }),
    );

    expect(
      authorizeRuntimeAction(
        agentInput({ attestedEdgeApprovals: [withUnknownKey, invalidSignature] }),
      ),
    ).toMatchObject({
      reason: { type: "attestation_key_unknown", evidenceKind: "call_graph_edge_approval" },
    });
    expect(
      authorizeRuntimeAction(
        agentInput({ attestedEdgeApprovals: [invalidSignature, withUnknownKey] }),
      ),
    ).toMatchObject({
      reason: { type: "attestation_invalid", evidenceKind: "call_graph_edge_approval" },
    });
  });

  it("filters only verified rejected decisions before authority evaluation", () => {
    const rejected = edgeApproval(
      { requiresHumanGate: true },
      { decision: "rejected", reason: "denied" },
    );
    expect(
      authorizeRuntimeAction(agentInput({ attestedEdgeApprovals: [rejected] })),
    ).toMatchObject({ reason: { type: "call_edge_not_approved" } });
    expect(
      authorizeRuntimeAction(
        agentInput({ attestedEdgeApprovals: [rejected, edgeApproval()] }),
      ),
    ).toMatchObject({ outcome: "allowed", actionType: "agent_call" });
  });

  it("treats a missing or wrong approval key scope identically to an unknown key", () => {
    const evidence = edgeApproval();
    const unknownKeyEvidence = {
      ...evidence,
      attestation: { ...evidence.attestation, keyId: "unknown-key" },
    };
    expect(
      authorizeRuntimeAction(
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
      authorizeRuntimeActionWithContext(
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

  it("keeps lifecycle and approval key purposes independently scoped", () => {
    expect(
      authorizeRuntimeActionWithContext(
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

  it("keeps global and declaration guards ahead of edge attestation", () => {
    const invalidApproval = mutateSignature(edgeApproval());
    expect(
      authorizeRuntimeAction(
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
      authorizeRuntimeAction(
        agentInput({
          action: undeclaredAction,
          attestedEdgeApprovals: [
            mutateSignature(edgeApproval({ calleeSpecId: "spec-billing" })),
          ],
        }),
      ),
    ).toMatchObject({ reason: { type: "agent_call_not_declared" } });
  });

  it("checks selected approval attestation before policy, cycle, and callee guards", () => {
    expect(
      authorizeRuntimeAction(
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

  it("treats duplicate presentation of the same approved evidence as ambiguous", () => {
    const evidence = edgeApproval();
    expect(
      authorizeRuntimeAction(
        agentInput({ attestedEdgeApprovals: [evidence, structuredClone(evidence)] }),
      ),
    ).toMatchObject({ reason: { type: "ambiguous_call_edge_approval" } });
  });

  it("requires callee lifecycle evidence only after cycle detection", () => {
    expect(authorizeRuntimeAction(baseInput({ action: agentAction }))).toEqual({
      outcome: "blocked",
      reason: {
        type: "callee_lifecycle_evidence_missing",
        calleeSpecId: "spec-web-search",
        calleeVersionOrChannel: "1.0.0",
      },
    });
    expect(
      authorizeRuntimeAction(
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

  it("maps callee unknown keys and invalid signatures to generic attestation reasons", () => {
    const evidence = lifecycleEvidence("callee");
    expect(
      authorizeRuntimeAction(
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
      authorizeRuntimeAction(
        agentInput({ calleeLifecycleEvidence: mutateSignature(evidence) }),
      ),
    ).toMatchObject({ reason: { type: "attestation_invalid", evidenceKind: "callee_lifecycle" } });
  });

  it.each([
    { specId: "spec-other" },
    { versionOrChannel: "stable" },
  ])("blocks exact opaque callee subject mismatch: %o", (overrides) => {
    expect(
      authorizeRuntimeAction(
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

  it("keeps callee callability distinct and limited to deployed", () => {
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

  it.each(nonCallableStates)("blocks signed callee state `%s` as not callable", (state) => {
    expect(
      authorizeRuntimeAction(
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

  it("checks callee state before freshness and freshness before depth or budget", () => {
    expect(
      authorizeRuntimeAction(
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
      authorizeRuntimeAction(
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

  it("uses half-open callee freshness with no future skew grace", () => {
    const evidence = lifecycleEvidence("callee", {
      assertedAt: "2026-07-23T13:00:00Z",
      freshnessTtl: 300,
    });
    expect(
      authorizeRuntimeAction(
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
      authorizeRuntimeAction(
        agentInput({
          actingLifecycleEvidence: lifecycleEvidence("acting", {
            assertedAt: "2026-07-23T13:00:00Z",
          }),
          calleeLifecycleEvidence: evidence,
          runContextEvidence: runContextEvidence(runtimeSpec, {
            assertedAt: "2026-07-23T13:00:00Z",
          }),
        }),
        { authorizationTime: "2026-07-23T13:04:59.999Z" },
      ),
    ).toMatchObject({ outcome: "allowed" });
    expect(
      authorizeRuntimeAction(
        agentInput({
          actingLifecycleEvidence: lifecycleEvidence("acting", {
            assertedAt: "2026-07-23T13:04:00Z",
          }),
          calleeLifecycleEvidence: evidence,
          runContextEvidence: runContextEvidence(runtimeSpec, {
            assertedAt: "2026-07-23T13:04:00Z",
          }),
        }),
        { authorizationTime: "2026-07-23T13:05:00Z" },
      ),
    ).toMatchObject({
      reason: { type: "lifecycle_evidence_not_fresh", role: "callee", condition: "expired" },
    });
  });

  it("rejects an acting-domain signature replayed as callee evidence", () => {
    const payload = lifecycleEvidence("callee").payload;
    expect(
      authorizeRuntimeAction(
        agentInput({ calleeLifecycleEvidence: attestLifecycle(payload, "acting") }),
      ),
    ).toMatchObject({
      reason: { type: "attestation_invalid", evidenceKind: "callee_lifecycle" },
    });
  });

  it("preserves declaration, edge, human-gate, ambiguity, intent, and cycle precedence", () => {
    const invalidCallee = mutateSignature(lifecycleEvidence("callee"));
    expect(
      authorizeRuntimeAction(
        agentInput({
          action: { ...agentAction, calleeSpecId: SpecIdSchema.parse("spec-billing") },
          calleeLifecycleEvidence: invalidCallee,
        }),
      ),
    ).toMatchObject({ reason: { type: "agent_call_not_declared" } });
    expect(
      authorizeRuntimeAction(agentInput({ attestedEdgeApprovals: [], calleeLifecycleEvidence: invalidCallee })),
    ).toMatchObject({ reason: { type: "call_edge_not_approved" } });
    expect(
      authorizeRuntimeAction(
        agentInput({
          attestedEdgeApprovals: [
            edgeApproval({ requiresHumanGate: false }),
            edgeApproval({ requiresHumanGate: true }),
          ],
          calleeLifecycleEvidence: invalidCallee,
        }),
      ),
    ).toMatchObject({ reason: { type: "human_gate_required" } });
    expect(
      authorizeRuntimeAction(
        agentInput({
          attestedEdgeApprovals: [edgeApproval(), edgeApproval({ maxCallsPerRun: 2 })],
          calleeLifecycleEvidence: invalidCallee,
        }),
      ),
    ).toMatchObject({ reason: { type: "ambiguous_call_edge_approval" } });
    expect(
      authorizeRuntimeAction(
        agentInput({
          attestedEdgeApprovals: [edgeApproval({ allowedIntents: ["delegate"] })],
          calleeLifecycleEvidence: invalidCallee,
        }),
      ),
    ).toMatchObject({ reason: { type: "call_intent_not_allowed" } });
    expect(
      authorizeRuntimeAction(
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

  it("preserves depth, call-budget, and child-budget enforcement", () => {
    expect(
      authorizeRuntimeAction(
        agentInput({
          runContextEvidence: runContextEvidence(runtimeSpec, {
            callContext: callContext({ remainingDepth: 0 }),
          }),
        }),
      ),
    ).toMatchObject({ reason: { type: "depth_exhausted" } });
    expect(
      authorizeRuntimeAction(
        agentInput({
          runContextEvidence: runContextEvidence(runtimeSpec, {
            callContext: callContext({ remainingCallBudget: 0 }),
          }),
        }),
      ),
    ).toMatchObject({ reason: { type: "call_budget_exhausted" } });
    expect(
      authorizeRuntimeAction(
        agentInput({
          action: {
            ...agentAction,
            childBudget: { callBudget: 4, tokenBudget: 25_000, timeBudget: 40_000 },
          },
        }),
      ),
    ).toMatchObject({ reason: { type: "budget_increase_forbidden" } });
  });

  it("treats a channel as an exact opaque signed subject key", () => {
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
      authorizeRuntimeAction(
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
  it("is deterministic and mutates neither evidence, keyset, spec, nor call context", () => {
    const input = agentInput();
    const context = structuredClone(authorizationContext);
    const inputSnapshot = structuredClone(input);
    const contextSnapshot = structuredClone(context);

    const first = authorizeRuntimeActionWithContext(input, context);
    const second = authorizeRuntimeActionWithContext(input, context);

    expect(first).toEqual(second);
    expect(input).toEqual(inputSnapshot);
    expect(context).toEqual(contextSnapshot);
  });
});

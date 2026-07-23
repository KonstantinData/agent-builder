import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DecidedCallGraphEdgeApprovalSchema } from "../../src/schema/approval-artifact.js";
import {
  ACTING_LIFECYCLE_ATTESTATION_DOMAIN,
  ATTESTATION_EVIDENCE_KINDS,
  AgentLifecycleEvidencePayloadSchema,
  AttestationEnvelopeSchema,
  AttestedAgentLifecycleEvidenceSchema,
  AttestedCallGraphEdgeApprovalSchema,
  AttestedRunContextEvidenceSchema,
  AttestedRuntimeBindingEvidenceSchema,
  CALLEE_LIFECYCLE_ATTESTATION_DOMAIN,
  CALL_GRAPH_EDGE_APPROVAL_ATTESTATION_DOMAIN,
  Ed25519PublicKeySpkiDerBase64Schema,
  LifecycleEvidenceFreshnessTtlSchema,
  MAX_LIFECYCLE_EVIDENCE_FRESHNESS_SECONDS,
  MAX_RUN_CONTEXT_EVIDENCE_FRESHNESS_SECONDS,
  RUN_CONTEXT_ATTESTATION_DOMAIN,
  RunContextEvidencePayloadSchema,
  RunContextFreshnessTtlSchema,
  RUNTIME_BINDING_ATTESTATION_DOMAIN,
  TrustedAttestationKeysetSchema,
} from "../../src/schema/runtime-attestation.js";
import { RuntimeBindingArtifactSchema } from "../../src/schema/runtime-binding.js";
import {
  RUNTIME_ATTESTATION_DOMAINS,
  RUNTIME_ATTESTATION_DOMAIN_BY_EVIDENCE_KIND,
  createAttestationPreimage,
  verifyEd25519Attestation,
} from "../../src/runtime/runtime-attestation.js";
import {
  TEST_ATTESTATION_KEY_ID,
  TEST_PRIVATE_KEY_PKCS8_DER_BASE64,
  TEST_PUBLIC_KEY_SPKI_DER_BASE64,
  TEST_TRUSTED_ATTESTATION_KEY,
  attestCallGraphEdgeApproval,
  attestRuntimeBinding,
  attestRunContext,
  signPayload,
} from "../support/runtime-attestation.js";

const lifecyclePayload = AgentLifecycleEvidencePayloadSchema.parse({
  specId: "spec-crm-enricher",
  versionOrChannel: "1.0.0",
  state: "deployed",
  assertedAt: "2026-07-23T12:00:00Z",
  freshnessTtl: 300,
});

const bindingPayload = RuntimeBindingArtifactSchema.parse({
  bindingId: "binding-001",
  specId: "spec-crm-enricher",
  version: "1.0.0",
  contentHash: "a".repeat(64),
  approvalArtifactId: "approval-001",
  runtimeInstanceId: "runtime-001",
  deployedAt: "2026-07-23T12:00:00Z",
  ttl: 3600,
});

const approvalPayload = DecidedCallGraphEdgeApprovalSchema.parse({
  type: "call_graph_edge",
  artifactId: "approval-edge-001",
  requestedBy: "builder-agent",
  decision: "approved",
  decidedBy: "policy-harness",
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

const runContextPayload = RunContextEvidencePayloadSchema.parse({
  specId: "spec-crm-enricher",
  version: "1.0.0",
  contentHash: "a".repeat(64),
  currentRunId: "run-root",
  callContext: {
    rootRunId: "run-root",
    parentRunId: null,
    callChain: ["spec-crm-enricher"],
    remainingDepth: 2,
    remainingCallBudget: 3,
    remainingTokenBudget: 20_000,
    remainingTimeBudget: 30_000,
  },
  assertedAt: "2026-07-23T12:00:00Z",
  freshnessTtl: 300,
});

describe("runtime attestation schemas", () => {
  it("pins all role- and payload-specific domain tags and evidence kinds", () => {
    expect(RUNTIME_BINDING_ATTESTATION_DOMAIN).toBe("agent-builder/attest/runtime-binding/v1");
    expect(ACTING_LIFECYCLE_ATTESTATION_DOMAIN).toBe(
      "agent-builder/attest/lifecycle/acting/v1",
    );
    expect(CALLEE_LIFECYCLE_ATTESTATION_DOMAIN).toBe(
      "agent-builder/attest/lifecycle/callee/v1",
    );
    expect(CALL_GRAPH_EDGE_APPROVAL_ATTESTATION_DOMAIN).toBe(
      "agent-builder/attest/approval/call-graph-edge/v1",
    );
    expect(RUN_CONTEXT_ATTESTATION_DOMAIN).toBe("agent-builder/attest/run-context/v1");
    expect(RUNTIME_ATTESTATION_DOMAINS).toEqual([
      RUNTIME_BINDING_ATTESTATION_DOMAIN,
      ACTING_LIFECYCLE_ATTESTATION_DOMAIN,
      CALLEE_LIFECYCLE_ATTESTATION_DOMAIN,
      CALL_GRAPH_EDGE_APPROVAL_ATTESTATION_DOMAIN,
      RUN_CONTEXT_ATTESTATION_DOMAIN,
    ]);
    expect(ATTESTATION_EVIDENCE_KINDS).toEqual([
      "runtime_binding",
      "acting_lifecycle",
      "callee_lifecycle",
      "call_graph_edge_approval",
      "run_context",
    ]);
    expect(RUNTIME_ATTESTATION_DOMAIN_BY_EVIDENCE_KIND).toEqual({
      runtime_binding: RUNTIME_BINDING_ATTESTATION_DOMAIN,
      acting_lifecycle: ACTING_LIFECYCLE_ATTESTATION_DOMAIN,
      callee_lifecycle: CALLEE_LIFECYCLE_ATTESTATION_DOMAIN,
      call_graph_edge_approval: CALL_GRAPH_EDGE_APPROVAL_ATTESTATION_DOMAIN,
      run_context: RUN_CONTEXT_ATTESTATION_DOMAIN,
    });
  });

  it("accepts only positive whole-second lifecycle freshness up to 300 seconds", () => {
    expect(MAX_LIFECYCLE_EVIDENCE_FRESHNESS_SECONDS).toBe(300);
    expect(LifecycleEvidenceFreshnessTtlSchema.safeParse(1).success).toBe(true);
    expect(LifecycleEvidenceFreshnessTtlSchema.safeParse(300).success).toBe(true);
    for (const value of [0, -1, 0.5, 301, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(LifecycleEvidenceFreshnessTtlSchema.safeParse(value).success).toBe(false);
    }
  });

  it("accepts only positive whole-second run-context freshness up to 300 seconds", () => {
    expect(MAX_RUN_CONTEXT_EVIDENCE_FRESHNESS_SECONDS).toBe(300);
    expect(RunContextFreshnessTtlSchema.safeParse(1).success).toBe(true);
    expect(RunContextFreshnessTtlSchema.safeParse(300).success).toBe(true);
    for (const value of [0, -1, 0.5, 301, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(RunContextFreshnessTtlSchema.safeParse(value).success).toBe(false);
    }
  });

  it("requires strict complete run-context payloads with non-empty run identities", () => {
    expect(RunContextEvidencePayloadSchema.safeParse(runContextPayload).success).toBe(true);
    for (const invalid of [
      { ...runContextPayload, currentRunId: "" },
      { ...runContextPayload, assertedAt: "2026-07-23T12:00:00" },
      { ...runContextPayload, freshnessTtl: 301 },
      { ...runContextPayload, callContext: { ...runContextPayload.callContext, rootRunId: "" } },
      { ...runContextPayload, callContext: { ...runContextPayload.callContext, parentRunId: "" } },
      { ...runContextPayload, callContext: { ...runContextPayload.callContext, callChain: [] } },
      { ...runContextPayload, extra: "field" },
    ]) {
      expect(RunContextEvidencePayloadSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("requires complete strict lifecycle payloads with unambiguous timestamps", () => {
    expect(AgentLifecycleEvidencePayloadSchema.safeParse(lifecyclePayload).success).toBe(true);
    for (const invalid of [
      { ...lifecyclePayload, assertedAt: "2026-07-23T12:00:00" },
      { ...lifecyclePayload, freshnessTtl: 301 },
      { ...lifecyclePayload, extra: "field" },
      { specId: lifecyclePayload.specId, state: "deployed" },
    ]) {
      expect(AgentLifecycleEvidencePayloadSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("requires canonical base64 signatures of exactly 64 bytes and no algorithm field", () => {
    const valid = signPayload(ACTING_LIFECYCLE_ATTESTATION_DOMAIN, lifecyclePayload);
    expect(AttestationEnvelopeSchema.safeParse(valid).success).toBe(true);
    for (const invalid of [
      { ...valid, keyId: "" },
      { ...valid, signatureBase64: Buffer.alloc(63).toString("base64") },
      { ...valid, signatureBase64: Buffer.alloc(65).toString("base64") },
      { ...valid, signatureBase64: valid.signatureBase64.replace(/=$/, "") },
      { ...valid, signatureBase64: `${valid.signatureBase64} ` },
      { ...valid, alg: "ed25519" },
    ]) {
      expect(AttestationEnvelopeSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("rejects oversized attestation material before cryptographic parsing", () => {
    const oversized = "A".repeat(1024 * 1024);
    expect(
      AttestationEnvelopeSchema.safeParse({
        keyId: TEST_ATTESTATION_KEY_ID,
        signatureBase64: oversized,
      }).success,
    ).toBe(false);
    expect(Ed25519PublicKeySpkiDerBase64Schema.safeParse(oversized).success).toBe(false);
  });

  it("accepts only canonical Ed25519 SPKI DER public keys", () => {
    expect(
      Ed25519PublicKeySpkiDerBase64Schema.safeParse(TEST_PUBLIC_KEY_SPKI_DER_BASE64).success,
    ).toBe(true);
    expect(
      Ed25519PublicKeySpkiDerBase64Schema.safeParse(TEST_PRIVATE_KEY_PKCS8_DER_BASE64).success,
    ).toBe(false);

    const withTrailingByte = Buffer.concat([
      Buffer.from(TEST_PUBLIC_KEY_SPKI_DER_BASE64, "base64"),
      Buffer.from([0]),
    ]).toString("base64");
    expect(Ed25519PublicKeySpkiDerBase64Schema.safeParse(withTrailingByte).success).toBe(false);

    for (const algorithm of ["rsa", "ec"] as const) {
      const { publicKey } =
        algorithm === "rsa"
          ? generateKeyPairSync("rsa", { modulusLength: 1024 })
          : generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      const encoded = publicKey.export({ format: "der", type: "spki" }).toString("base64");
      expect(Ed25519PublicKeySpkiDerBase64Schema.safeParse(encoded).success).toBe(false);
    }
  });

  it("requires a non-empty keyset with unique keyIds", () => {
    expect(TrustedAttestationKeysetSchema.safeParse([TEST_TRUSTED_ATTESTATION_KEY]).success).toBe(true);
    expect(TrustedAttestationKeysetSchema.safeParse([]).success).toBe(false);
    expect(
      TrustedAttestationKeysetSchema.safeParse([
        TEST_TRUSTED_ATTESTATION_KEY,
        TEST_TRUSTED_ATTESTATION_KEY,
      ]).success,
    ).toBe(false);
  });

  it("requires explicit non-empty and duplicate-free evidence kinds on every key", () => {
    const { allowedEvidenceKinds: _ignored, ...legacyKey } = TEST_TRUSTED_ATTESTATION_KEY;
    for (const candidate of [
      legacyKey,
      { ...TEST_TRUSTED_ATTESTATION_KEY, allowedEvidenceKinds: [] },
      {
        ...TEST_TRUSTED_ATTESTATION_KEY,
        allowedEvidenceKinds: ["runtime_binding", "runtime_binding"],
      },
      { ...TEST_TRUSTED_ATTESTATION_KEY, allowedEvidenceKinds: ["unknown"] },
    ]) {
      expect(TrustedAttestationKeysetSchema.safeParse([candidate]).success).toBe(false);
    }
  });

  it("accepts only strict payload-plus-envelope evidence wrappers", () => {
    const lifecycleEvidence = {
      payload: lifecyclePayload,
      attestation: signPayload(ACTING_LIFECYCLE_ATTESTATION_DOMAIN, lifecyclePayload),
    };
    const bindingEvidence = attestRuntimeBinding(bindingPayload);
    const approvalEvidence = attestCallGraphEdgeApproval(approvalPayload);
    const runContextEvidence = attestRunContext(runContextPayload);
    expect(AttestedAgentLifecycleEvidenceSchema.safeParse(lifecycleEvidence).success).toBe(true);
    expect(AttestedRuntimeBindingEvidenceSchema.safeParse(bindingEvidence).success).toBe(true);
    expect(AttestedCallGraphEdgeApprovalSchema.safeParse(approvalEvidence).success).toBe(true);
    expect(AttestedRunContextEvidenceSchema.safeParse(runContextEvidence).success).toBe(true);
    expect(
      AttestedAgentLifecycleEvidenceSchema.safeParse({ ...lifecycleEvidence, keyId: "outside-envelope" }).success,
    ).toBe(false);
    expect(
      AttestedRuntimeBindingEvidenceSchema.safeParse({
        payload: { ...bindingPayload, approvalArtifactId: undefined },
        attestation: bindingEvidence.attestation,
      }).success,
    ).toBe(false);
  });
});

describe("runtime attestation canonical preimages and Ed25519 vectors", () => {
  it("pins canonical JSON, complete UTF-8 preimage bytes, and a fixed acting signature", () => {
    const canonicalJson =
      '{"assertedAt":"2026-07-23T12:00:00Z","freshnessTtl":300,"specId":"spec-crm-enricher","state":"deployed","versionOrChannel":"1.0.0"}';
    const expectedPreimage = Buffer.from(
      `${ACTING_LIFECYCLE_ATTESTATION_DOMAIN}\n${canonicalJson}`,
      "utf8",
    );
    const preimage = createAttestationPreimage(
      ACTING_LIFECYCLE_ATTESTATION_DOMAIN,
      lifecyclePayload,
    );
    expect(preimage).toEqual(expectedPreimage);
    expect(preimage.toString("utf8")).toBe(
      `agent-builder/attest/lifecycle/acting/v1\n${canonicalJson}`,
    );

    const envelope = signPayload(ACTING_LIFECYCLE_ATTESTATION_DOMAIN, lifecyclePayload);
    expect(envelope.signatureBase64).toBe(
      "7c2Edij51pFmeq/YxFHaAKshZATdDX+zV/FcPpID5a1CqBdSVNU/0CYUowidgGkjLrvT1T595Kfy1a2mqvQ3CQ==",
    );
    expect(
      verifyEd25519Attestation(
        ACTING_LIFECYCLE_ATTESTATION_DOMAIN,
        lifecyclePayload,
        envelope,
        TEST_TRUSTED_ATTESTATION_KEY,
      ),
    ).toBe(true);
  });

  it("pins an independent call-graph approval preimage and signature vector", () => {
    const canonicalJson =
      '{"artifactId":"approval-edge-001","decidedAt":"2026-07-23T12:00:00Z","decidedBy":"policy-harness","decision":"approved","edge":{"allowedIntents":["query"],"calleeSpecId":"spec-web-search","calleeVersionOrChannel":"1.0.0","callerSpecId":"spec-crm-enricher","callerVersion":"1.0.0","dataShareScope":"tenant:acme:crm","maxCallsPerRun":3,"maxCallsPerTimeWindow":100,"maxDepth":1,"requiresHumanGate":false,"trustDomainId":"domain-sales"},"requestedBy":"builder-agent","type":"call_graph_edge"}';
    const expectedPreimage = Buffer.from(
      `${CALL_GRAPH_EDGE_APPROVAL_ATTESTATION_DOMAIN}\n${canonicalJson}`,
      "utf8",
    );
    const preimage = createAttestationPreimage(
      CALL_GRAPH_EDGE_APPROVAL_ATTESTATION_DOMAIN,
      approvalPayload,
    );
    expect(preimage).toEqual(expectedPreimage);
    expect(preimage.toString("hex")).toBe(
      "6167656e742d6275696c6465722f6174746573742f617070726f76616c2f63616c6c2d67726170682d656467652f76310a7b2261727469666163744964223a22617070726f76616c2d656467652d303031222c22646563696465644174223a22323032362d30372d32335431323a30303a30305a222c22646563696465644279223a22706f6c6963792d6861726e657373222c226465636973696f6e223a22617070726f766564222c2265646765223a7b22616c6c6f776564496e74656e7473223a5b227175657279225d2c2263616c6c6565537065634964223a22737065632d7765622d736561726368222c2263616c6c656556657273696f6e4f724368616e6e656c223a22312e302e30222c2263616c6c6572537065634964223a22737065632d63726d2d656e726963686572222c2263616c6c657256657273696f6e223a22312e302e30222c2264617461536861726553636f7065223a2274656e616e743a61636d653a63726d222c226d617843616c6c7350657252756e223a332c226d617843616c6c7350657254696d6557696e646f77223a3130302c226d61784465707468223a312c22726571756972657348756d616e47617465223a66616c73652c227472757374446f6d61696e4964223a22646f6d61696e2d73616c6573227d2c227265717565737465644279223a226275696c6465722d6167656e74222c2274797065223a2263616c6c5f67726170685f65646765227d",
    );

    const envelope = signPayload(CALL_GRAPH_EDGE_APPROVAL_ATTESTATION_DOMAIN, approvalPayload);
    expect(envelope.signatureBase64).toBe(
      "455A8uxGmGPcAlxAwMoiG26asCmEITY/2XRIkMSRokVIaKTEHv70CbI6FXaX5nC+zmn/YZc0nHZUYjqG42zFBg==",
    );
    expect(
      verifyEd25519Attestation(
        CALL_GRAPH_EDGE_APPROVAL_ATTESTATION_DOMAIN,
        approvalPayload,
        envelope,
        TEST_TRUSTED_ATTESTATION_KEY,
      ),
    ).toBe(true);
  });

  it("pins an independent run-context canonical preimage and signature vector", () => {
    const canonicalJson =
      '{"assertedAt":"2026-07-23T12:00:00Z","callContext":{"callChain":["spec-crm-enricher"],"parentRunId":null,"remainingCallBudget":3,"remainingDepth":2,"remainingTimeBudget":30000,"remainingTokenBudget":20000,"rootRunId":"run-root"},"contentHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","currentRunId":"run-root","freshnessTtl":300,"specId":"spec-crm-enricher","version":"1.0.0"}';
    const expectedPreimage = Buffer.from(
      `${RUN_CONTEXT_ATTESTATION_DOMAIN}\n${canonicalJson}`,
      "utf8",
    );
    const preimage = createAttestationPreimage(
      RUN_CONTEXT_ATTESTATION_DOMAIN,
      runContextPayload,
    );
    expect(preimage).toEqual(expectedPreimage);
    expect(preimage.toString("hex")).toBe(
      "6167656e742d6275696c6465722f6174746573742f72756e2d636f6e746578742f76310a7b2261737365727465644174223a22323032362d30372d32335431323a30303a30305a222c2263616c6c436f6e74657874223a7b2263616c6c436861696e223a5b22737065632d63726d2d656e726963686572225d2c22706172656e7452756e4964223a6e756c6c2c2272656d61696e696e6743616c6c427564676574223a332c2272656d61696e696e674465707468223a322c2272656d61696e696e6754696d65427564676574223a33303030302c2272656d61696e696e67546f6b656e427564676574223a32303030302c22726f6f7452756e4964223a2272756e2d726f6f74227d2c22636f6e74656e7448617368223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c2263757272656e7452756e4964223a2272756e2d726f6f74222c2266726573686e65737354746c223a3330302c22737065634964223a22737065632d63726d2d656e726963686572222c2276657273696f6e223a22312e302e30227d",
    );

    const envelope = signPayload(RUN_CONTEXT_ATTESTATION_DOMAIN, runContextPayload);
    expect(envelope.signatureBase64).toBe(
      "O/gpgBYP/mTvYMNMxvzsHRxWDHmEPY9LfagUdxKhsXFahm6yfsZrtWqo9JiqrQROp73cf79mFfKak1kT50DkDQ==",
    );
    expect(
      verifyEd25519Attestation(
        RUN_CONTEXT_ATTESTATION_DOMAIN,
        runContextPayload,
        envelope,
        TEST_TRUSTED_ATTESTATION_KEY,
      ),
    ).toBe(true);
  });

  it("normalizes an omitted or undefined approval reason to identical signed bytes", () => {
    const omitted = DecidedCallGraphEdgeApprovalSchema.parse(approvalPayload);
    const explicitUndefined = DecidedCallGraphEdgeApprovalSchema.parse({
      ...approvalPayload,
      reason: undefined,
    });
    expect(
      createAttestationPreimage(CALL_GRAPH_EDGE_APPROVAL_ATTESTATION_DOMAIN, omitted),
    ).toEqual(
      createAttestationPreimage(
        CALL_GRAPH_EDGE_APPROVAL_ATTESTATION_DOMAIN,
        explicitUndefined,
      ),
    );
    expect(
      signPayload(CALL_GRAPH_EDGE_APPROVAL_ATTESTATION_DOMAIN, omitted),
    ).toEqual(signPayload(CALL_GRAPH_EDGE_APPROVAL_ATTESTATION_DOMAIN, explicitUndefined));
    expect(
      createAttestationPreimage(
        CALL_GRAPH_EDGE_APPROVAL_ATTESTATION_DOMAIN,
        Object.fromEntries(Object.entries(omitted).reverse()),
      ),
    ).toEqual(
      createAttestationPreimage(CALL_GRAPH_EDGE_APPROVAL_ATTESTATION_DOMAIN, omitted),
    );
  });

  it("is invariant to object insertion order but excludes the envelope from signed bytes", () => {
    const reordered = Object.fromEntries(Object.entries(lifecyclePayload).reverse());
    expect(
      createAttestationPreimage(ACTING_LIFECYCLE_ATTESTATION_DOMAIN, reordered),
    ).toEqual(
      createAttestationPreimage(ACTING_LIFECYCLE_ATTESTATION_DOMAIN, lifecyclePayload),
    );
    const wrapper = {
      payload: lifecyclePayload,
      attestation: signPayload(ACTING_LIFECYCLE_ATTESTATION_DOMAIN, lifecyclePayload),
    };
    expect(
      createAttestationPreimage(ACTING_LIFECYCLE_ATTESTATION_DOMAIN, wrapper),
    ).not.toEqual(
      createAttestationPreimage(ACTING_LIFECYCLE_ATTESTATION_DOMAIN, lifecyclePayload),
    );
  });

  it("prevents acting/callee cross-role replay for an identical payload", () => {
    const actingEnvelope = signPayload(ACTING_LIFECYCLE_ATTESTATION_DOMAIN, lifecyclePayload);
    const calleeEnvelope = signPayload(CALLEE_LIFECYCLE_ATTESTATION_DOMAIN, lifecyclePayload);
    expect(actingEnvelope.signatureBase64).toBe(
      "7c2Edij51pFmeq/YxFHaAKshZATdDX+zV/FcPpID5a1CqBdSVNU/0CYUowidgGkjLrvT1T595Kfy1a2mqvQ3CQ==",
    );
    expect(calleeEnvelope.signatureBase64).toBe(
      "16OYWq3Cr8zIaOIk0zRdwYRRE/M2IKRBaz9vff1Ks9SrQDMllX015BPKa907rU8NbvDwW0k+Au2IVOVI2i//Ag==",
    );
    expect(
      verifyEd25519Attestation(
        CALLEE_LIFECYCLE_ATTESTATION_DOMAIN,
        lifecyclePayload,
        actingEnvelope,
        TEST_TRUSTED_ATTESTATION_KEY,
      ),
    ).toBe(false);
    expect(
      verifyEd25519Attestation(
        ACTING_LIFECYCLE_ATTESTATION_DOMAIN,
        lifecyclePayload,
        calleeEnvelope,
        TEST_TRUSTED_ATTESTATION_KEY,
      ),
    ).toBe(false);
  });

  it("binds every runtime artifact field and every lifecycle payload field", () => {
    const bindingEvidence = attestRuntimeBinding(bindingPayload);
    for (const key of Object.keys(bindingPayload)) {
      expect(
        verifyEd25519Attestation(
          RUNTIME_BINDING_ATTESTATION_DOMAIN,
          { ...bindingPayload, [key]: `${String(bindingPayload[key as keyof typeof bindingPayload])}-changed` },
          bindingEvidence.attestation,
          TEST_TRUSTED_ATTESTATION_KEY,
        ),
      ).toBe(false);
    }

    const lifecycleEnvelope = signPayload(ACTING_LIFECYCLE_ATTESTATION_DOMAIN, lifecyclePayload);
    for (const key of Object.keys(lifecyclePayload)) {
      expect(
        verifyEd25519Attestation(
          ACTING_LIFECYCLE_ATTESTATION_DOMAIN,
          { ...lifecyclePayload, [key]: `${String(lifecyclePayload[key as keyof typeof lifecyclePayload])}-changed` },
          lifecycleEnvelope,
          TEST_TRUSTED_ATTESTATION_KEY,
        ),
      ).toBe(false);
    }
  });

  it("binds every approval decision and edge field, including an optional reason", () => {
    const withReason = DecidedCallGraphEdgeApprovalSchema.parse({
      ...approvalPayload,
      reason: "approved for runtime delegation",
    });
    const envelope = signPayload(CALL_GRAPH_EDGE_APPROVAL_ATTESTATION_DOMAIN, withReason);
    const topLevelMutations = [
      { ...withReason, type: "agent_spec" },
      { ...withReason, artifactId: "approval-other" },
      { ...withReason, requestedBy: "other-requestor" },
      { ...withReason, decision: "rejected" as const },
      { ...withReason, decidedBy: "other-decider" },
      { ...withReason, decidedAt: "2026-07-23T12:00:01Z" },
      { ...withReason, reason: "changed reason" },
      { ...withReason, reason: undefined },
    ];
    const edgeMutations = Object.keys(withReason.edge).map((key) => ({
      ...withReason,
      edge: {
        ...withReason.edge,
        [key]:
          key === "requiresHumanGate"
            ? !withReason.edge.requiresHumanGate
            : `${String(withReason.edge[key as keyof typeof withReason.edge])}-changed`,
      },
    }));

    for (const mutated of [...topLevelMutations, ...edgeMutations]) {
      expect(
        verifyEd25519Attestation(
          CALL_GRAPH_EDGE_APPROVAL_ATTESTATION_DOMAIN,
          mutated,
          envelope,
          TEST_TRUSTED_ATTESTATION_KEY,
        ),
      ).toBe(false);
    }
  });

  it("binds every run-context subject, identity, freshness, chain, and budget field", () => {
    const envelope = signPayload(RUN_CONTEXT_ATTESTATION_DOMAIN, runContextPayload);
    const topLevelMutations = Object.keys(runContextPayload)
      .filter((key) => key !== "callContext")
      .map((key) => ({
        ...runContextPayload,
        [key]: `${String(runContextPayload[key as keyof typeof runContextPayload])}-changed`,
      }));
    const callContextMutations = Object.keys(runContextPayload.callContext).map((key) => ({
      ...runContextPayload,
      callContext: {
        ...runContextPayload.callContext,
        [key]:
          key === "callChain"
            ? ["spec-other"]
            : key === "parentRunId" || key === "rootRunId"
              ? "run-other"
              : Number(runContextPayload.callContext[key as keyof typeof runContextPayload.callContext]) + 1,
      },
    }));

    for (const mutated of [...topLevelMutations, ...callContextMutations]) {
      expect(
        verifyEd25519Attestation(
          RUN_CONTEXT_ATTESTATION_DOMAIN,
          mutated,
          envelope,
          TEST_TRUSTED_ATTESTATION_KEY,
        ),
      ).toBe(false);
    }
  });

  it("prevents run-context signatures from replaying across every earlier evidence domain", () => {
    const runContextEnvelope = signPayload(
      RUN_CONTEXT_ATTESTATION_DOMAIN,
      runContextPayload,
    );
    for (const domain of [
      RUNTIME_BINDING_ATTESTATION_DOMAIN,
      ACTING_LIFECYCLE_ATTESTATION_DOMAIN,
      CALLEE_LIFECYCLE_ATTESTATION_DOMAIN,
      CALL_GRAPH_EDGE_APPROVAL_ATTESTATION_DOMAIN,
    ] as const) {
      expect(
        verifyEd25519Attestation(
          domain,
          runContextPayload,
          runContextEnvelope,
          TEST_TRUSTED_ATTESTATION_KEY,
        ),
      ).toBe(false);
      expect(
        verifyEd25519Attestation(
          RUN_CONTEXT_ATTESTATION_DOMAIN,
          runContextPayload,
          signPayload(domain, runContextPayload),
          TEST_TRUSTED_ATTESTATION_KEY,
        ),
      ).toBe(false);
    }
  });

  it("prevents approval signatures from replaying across Step-10 domains and vice versa", () => {
    const approvalEnvelope = signPayload(
      CALL_GRAPH_EDGE_APPROVAL_ATTESTATION_DOMAIN,
      approvalPayload,
    );
    for (const domain of [
      RUNTIME_BINDING_ATTESTATION_DOMAIN,
      ACTING_LIFECYCLE_ATTESTATION_DOMAIN,
      CALLEE_LIFECYCLE_ATTESTATION_DOMAIN,
    ] as const) {
      expect(
        verifyEd25519Attestation(
          domain,
          approvalPayload,
          approvalEnvelope,
          TEST_TRUSTED_ATTESTATION_KEY,
        ),
      ).toBe(false);
      const step10Envelope = signPayload(domain, approvalPayload);
      expect(
        verifyEd25519Attestation(
          CALL_GRAPH_EDGE_APPROVAL_ATTESTATION_DOMAIN,
          approvalPayload,
          step10Envelope,
          TEST_TRUSTED_ATTESTATION_KEY,
        ),
      ).toBe(false);
    }
  });

  it("does not accept a binding signature under either lifecycle domain", () => {
    const evidence = attestRuntimeBinding(bindingPayload);
    for (const domain of [
      ACTING_LIFECYCLE_ATTESTATION_DOMAIN,
      CALLEE_LIFECYCLE_ATTESTATION_DOMAIN,
    ] as const) {
      expect(
        verifyEd25519Attestation(
          domain,
          bindingPayload,
          evidence.attestation,
          TEST_TRUSTED_ATTESTATION_KEY,
        ),
      ).toBe(false);
    }
  });

  it("uses a fixed non-secret test private key only for deterministic vectors", () => {
    expect(TEST_ATTESTATION_KEY_ID).toBe("test-ed25519-2026-07");
    expect(TEST_PRIVATE_KEY_PKCS8_DER_BASE64).toBe(
      "MC4CAQAwBQYDK2VwBCIEIAABAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4f",
    );
  });
});

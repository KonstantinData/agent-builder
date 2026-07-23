import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ACTING_LIFECYCLE_ATTESTATION_DOMAIN,
  AgentLifecycleEvidencePayloadSchema,
  AttestationEnvelopeSchema,
  AttestedAgentLifecycleEvidenceSchema,
  AttestedRuntimeBindingEvidenceSchema,
  CALLEE_LIFECYCLE_ATTESTATION_DOMAIN,
  Ed25519PublicKeySpkiDerBase64Schema,
  LifecycleEvidenceFreshnessTtlSchema,
  MAX_LIFECYCLE_EVIDENCE_FRESHNESS_SECONDS,
  RUNTIME_BINDING_ATTESTATION_DOMAIN,
  TrustedAttestationKeysetSchema,
} from "../../src/schema/runtime-attestation.js";
import { RuntimeBindingArtifactSchema } from "../../src/schema/runtime-binding.js";
import {
  createAttestationPreimage,
  verifyEd25519Attestation,
} from "../../src/runtime/runtime-attestation.js";
import {
  TEST_ATTESTATION_KEY_ID,
  TEST_PRIVATE_KEY_PKCS8_DER_BASE64,
  TEST_PUBLIC_KEY_SPKI_DER_BASE64,
  TEST_TRUSTED_ATTESTATION_KEY,
  attestRuntimeBinding,
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

describe("runtime attestation schemas", () => {
  it("pins the three role- and payload-specific domain tags", () => {
    expect(RUNTIME_BINDING_ATTESTATION_DOMAIN).toBe("agent-builder/attest/runtime-binding/v1");
    expect(ACTING_LIFECYCLE_ATTESTATION_DOMAIN).toBe(
      "agent-builder/attest/lifecycle/acting/v1",
    );
    expect(CALLEE_LIFECYCLE_ATTESTATION_DOMAIN).toBe(
      "agent-builder/attest/lifecycle/callee/v1",
    );
  });

  it("accepts only positive whole-second lifecycle freshness up to 300 seconds", () => {
    expect(MAX_LIFECYCLE_EVIDENCE_FRESHNESS_SECONDS).toBe(300);
    expect(LifecycleEvidenceFreshnessTtlSchema.safeParse(1).success).toBe(true);
    expect(LifecycleEvidenceFreshnessTtlSchema.safeParse(300).success).toBe(true);
    for (const value of [0, -1, 0.5, 301, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(LifecycleEvidenceFreshnessTtlSchema.safeParse(value).success).toBe(false);
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

  it("accepts only strict payload-plus-envelope evidence wrappers", () => {
    const lifecycleEvidence = {
      payload: lifecyclePayload,
      attestation: signPayload(ACTING_LIFECYCLE_ATTESTATION_DOMAIN, lifecyclePayload),
    };
    const bindingEvidence = attestRuntimeBinding(bindingPayload);
    expect(AttestedAgentLifecycleEvidenceSchema.safeParse(lifecycleEvidence).success).toBe(true);
    expect(AttestedRuntimeBindingEvidenceSchema.safeParse(bindingEvidence).success).toBe(true);
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

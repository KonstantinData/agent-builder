import { createPrivateKey, sign } from "node:crypto";
import type { DecidedCallGraphEdgeApproval } from "../../src/schema/approval-artifact.js";
import type {
  AgentLifecycleEvidencePayload,
  AttestationEnvelope,
  AttestedAgentLifecycleEvidence,
  AttestedCallGraphEdgeApproval,
  AttestedRunContextEvidence,
  AttestedRuntimeBindingEvidence,
  RunContextEvidencePayload,
  TrustedAttestationKey,
} from "../../src/schema/runtime-attestation.js";
import {
  ACTING_LIFECYCLE_ATTESTATION_DOMAIN,
  ATTESTATION_EVIDENCE_KINDS,
  CALL_GRAPH_EDGE_APPROVAL_ATTESTATION_DOMAIN,
  CALLEE_LIFECYCLE_ATTESTATION_DOMAIN,
  RUN_CONTEXT_ATTESTATION_DOMAIN,
  RUNTIME_BINDING_ATTESTATION_DOMAIN,
} from "../../src/schema/runtime-attestation.js";
import type { RuntimeBindingArtifact } from "../../src/schema/runtime-binding.js";
import {
  createAttestationPreimage,
  type RuntimeAttestationDomain,
} from "../../src/runtime/runtime-attestation.js";

export const TEST_ATTESTATION_KEY_ID = "test-ed25519-2026-07";
export const TEST_PUBLIC_KEY_SPKI_DER_BASE64 =
  "MCowBQYDK2VwAyEAA6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg=";
export const TEST_PRIVATE_KEY_PKCS8_DER_BASE64 =
  "MC4CAQAwBQYDK2VwBCIEIAABAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4f";

export const SECOND_TEST_ATTESTATION_KEY_ID = "test-ed25519-rotated";
export const SECOND_TEST_PUBLIC_KEY_SPKI_DER_BASE64 =
  "MCowBQYDK2VwAyEAeBMvvUJdKcrv0YM9SZjHmB/KRNYtwilts4Hz9LD0GE4=";

export const TEST_TRUSTED_ATTESTATION_KEY: TrustedAttestationKey = {
  keyId: TEST_ATTESTATION_KEY_ID,
  publicKeySpkiDerBase64: TEST_PUBLIC_KEY_SPKI_DER_BASE64,
  allowedEvidenceKinds: [...ATTESTATION_EVIDENCE_KINDS],
};

export const SECOND_TEST_TRUSTED_ATTESTATION_KEY: TrustedAttestationKey = {
  keyId: SECOND_TEST_ATTESTATION_KEY_ID,
  publicKeySpkiDerBase64: SECOND_TEST_PUBLIC_KEY_SPKI_DER_BASE64,
  allowedEvidenceKinds: [...ATTESTATION_EVIDENCE_KINDS],
};

export function signPayload(
  domain: RuntimeAttestationDomain,
  payload: unknown,
  keyId = TEST_ATTESTATION_KEY_ID,
): AttestationEnvelope {
  const privateKey = createPrivateKey({
    key: Buffer.from(TEST_PRIVATE_KEY_PKCS8_DER_BASE64, "base64"),
    format: "der",
    type: "pkcs8",
  });
  return {
    keyId,
    signatureBase64: sign(
      null,
      createAttestationPreimage(domain, payload),
      privateKey,
    ).toString("base64"),
  };
}

export function attestRuntimeBinding(
  payload: RuntimeBindingArtifact,
): AttestedRuntimeBindingEvidence {
  return {
    payload,
    attestation: signPayload(RUNTIME_BINDING_ATTESTATION_DOMAIN, payload),
  };
}

export function attestLifecycle(
  payload: AgentLifecycleEvidencePayload,
  role: "acting" | "callee",
): AttestedAgentLifecycleEvidence {
  const domain =
    role === "acting"
      ? ACTING_LIFECYCLE_ATTESTATION_DOMAIN
      : CALLEE_LIFECYCLE_ATTESTATION_DOMAIN;
  return { payload, attestation: signPayload(domain, payload) };
}

export function attestCallGraphEdgeApproval(
  payload: DecidedCallGraphEdgeApproval,
): AttestedCallGraphEdgeApproval {
  return {
    payload,
    attestation: signPayload(CALL_GRAPH_EDGE_APPROVAL_ATTESTATION_DOMAIN, payload),
  };
}

export function attestRunContext(
  payload: RunContextEvidencePayload,
): AttestedRunContextEvidence {
  return {
    payload,
    attestation: signPayload(RUN_CONTEXT_ATTESTATION_DOMAIN, payload),
  };
}

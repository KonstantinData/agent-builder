import { createPublicKey, verify as verifySignature } from "node:crypto";
import { canonicalize } from "../assembler/content-hash.js";
import type {
  AttestationEvidenceKind,
  AttestationEnvelope,
  TrustedAttestationKey,
} from "../schema/runtime-attestation.js";
import {
  ACTING_LIFECYCLE_ATTESTATION_DOMAIN,
  CALL_GRAPH_EDGE_APPROVAL_ATTESTATION_DOMAIN,
  CALLEE_LIFECYCLE_ATTESTATION_DOMAIN,
  RUN_CONTEXT_ATTESTATION_DOMAIN,
  RUNTIME_BINDING_ATTESTATION_DOMAIN,
} from "../schema/runtime-attestation.js";

export const RUNTIME_ATTESTATION_DOMAINS = [
  RUNTIME_BINDING_ATTESTATION_DOMAIN,
  ACTING_LIFECYCLE_ATTESTATION_DOMAIN,
  CALLEE_LIFECYCLE_ATTESTATION_DOMAIN,
  CALL_GRAPH_EDGE_APPROVAL_ATTESTATION_DOMAIN,
  RUN_CONTEXT_ATTESTATION_DOMAIN,
] as const;
export type RuntimeAttestationDomain = (typeof RUNTIME_ATTESTATION_DOMAINS)[number];

/**
 * Single source of truth for evidence-kind/domain separation. The Record
 * binding makes a newly added evidence kind fail typecheck until it receives a
 * unique, versioned domain instead of relying on manual call-site pairing.
 */
export const RUNTIME_ATTESTATION_DOMAIN_BY_EVIDENCE_KIND = {
  runtime_binding: RUNTIME_BINDING_ATTESTATION_DOMAIN,
  acting_lifecycle: ACTING_LIFECYCLE_ATTESTATION_DOMAIN,
  callee_lifecycle: CALLEE_LIFECYCLE_ATTESTATION_DOMAIN,
  call_graph_edge_approval: CALL_GRAPH_EDGE_APPROVAL_ATTESTATION_DOMAIN,
  run_context: RUN_CONTEXT_ATTESTATION_DOMAIN,
} as const satisfies Record<AttestationEvidenceKind, RuntimeAttestationDomain>;

/**
 * The envelope is deliberately excluded. Only the strict, schema-validated
 * payload is canonicalized and prefixed with its evidence-specific versioned
 * domain tag before Ed25519 verification.
 */
export function createAttestationPreimage(
  domain: RuntimeAttestationDomain,
  payload: unknown,
): Buffer {
  const canonicalJson = JSON.stringify(canonicalize(payload));
  return Buffer.from(`${domain}\n${canonicalJson}`, "utf8");
}

export function verifyEd25519Attestation(
  domain: RuntimeAttestationDomain,
  payload: unknown,
  envelope: AttestationEnvelope,
  trustedKey: TrustedAttestationKey,
): boolean {
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(trustedKey.publicKeySpkiDerBase64, "base64"),
      format: "der",
      type: "spki",
    });
    return verifySignature(
      null,
      createAttestationPreimage(domain, payload),
      publicKey,
      Buffer.from(envelope.signatureBase64, "base64"),
    );
  } catch {
    // Trusted-context and input schemas validate both key and signature shape.
    // Keep the verifier fail-closed as defense in depth if it is reused directly.
    return false;
  }
}

import { createPublicKey } from "node:crypto";
import { z } from "zod";
import { LifecycleStateSchema, type LifecycleState } from "./agent-spec-runtime-metadata.js";
import {
  DecidedCallGraphEdgeApprovalSchema,
  type DecidedCallGraphEdgeApproval,
} from "./approval-artifact.js";
import { SpecIdSchema, type SpecId } from "./common.js";
import {
  CallContextSchema,
  RunIdSchema,
  type CallContext,
  type RunId,
} from "./call-context.js";
import { Rfc3339WithOffsetSchema } from "./runtime-binding-validity.js";
import { RuntimeBindingArtifactSchema, type RuntimeBindingArtifact } from "./runtime-binding.js";

export const RUNTIME_BINDING_ATTESTATION_DOMAIN =
  "agent-builder/attest/runtime-binding/v1";
export const ACTING_LIFECYCLE_ATTESTATION_DOMAIN =
  "agent-builder/attest/lifecycle/acting/v1";
export const CALLEE_LIFECYCLE_ATTESTATION_DOMAIN =
  "agent-builder/attest/lifecycle/callee/v1";
export const CALL_GRAPH_EDGE_APPROVAL_ATTESTATION_DOMAIN =
  "agent-builder/attest/approval/call-graph-edge/v1";
export const RUN_CONTEXT_ATTESTATION_DOMAIN =
  "agent-builder/attest/run-context/v1";

export const ATTESTATION_EVIDENCE_KINDS = [
  "runtime_binding",
  "acting_lifecycle",
  "callee_lifecycle",
  "call_graph_edge_approval",
  "run_context",
] as const;
export const AttestationEvidenceKindSchema = z.enum(ATTESTATION_EVIDENCE_KINDS);
export type AttestationEvidenceKind = z.infer<typeof AttestationEvidenceKindSchema>;

export const MAX_LIFECYCLE_EVIDENCE_FRESHNESS_SECONDS = 300;

export const LifecycleEvidenceFreshnessTtlSchema = z
  .number()
  .int()
  .positive()
  .max(MAX_LIFECYCLE_EVIDENCE_FRESHNESS_SECONDS);
export type LifecycleEvidenceFreshnessTtl = z.infer<
  typeof LifecycleEvidenceFreshnessTtlSchema
>;

export const MAX_RUN_CONTEXT_EVIDENCE_FRESHNESS_SECONDS = 300;

export const RunContextFreshnessTtlSchema = z
  .number()
  .int()
  .positive()
  .max(MAX_RUN_CONTEXT_EVIDENCE_FRESHNESS_SECONDS);
export type RunContextFreshnessTtl = z.infer<typeof RunContextFreshnessTtlSchema>;

export const RUN_CONTEXT_FRESHNESS_CONDITIONS = ["from_future", "expired"] as const;
export const RunContextFreshnessConditionSchema = z.enum(RUN_CONTEXT_FRESHNESS_CONDITIONS);
export type RunContextFreshnessCondition = z.infer<
  typeof RunContextFreshnessConditionSchema
>;

function isCanonicalBase64(value: string, expectedByteLength?: number): boolean {
  if (
    expectedByteLength !== undefined &&
    value.length !== 4 * Math.ceil(expectedByteLength / 3)
  ) {
    return false;
  }
  const decoded = Buffer.from(value, "base64");
  return (
    (expectedByteLength === undefined || decoded.byteLength === expectedByteLength) &&
    decoded.toString("base64") === value
  );
}

export const Ed25519SignatureBase64Schema = z
  .string()
  .length(88)
  .refine((value) => isCanonicalBase64(value, 64), {
    message: "signature must be canonical base64 encoding of exactly 64 bytes",
  });

export const Ed25519PublicKeySpkiDerBase64Schema = z
  .string()
  .length(60)
  .refine((value) => isCanonicalBase64(value, 44), {
    message: "public key must use canonical base64 encoding",
  })
  .refine(
    (value) => {
      if (value.length !== 60) {
        return false;
      }
      try {
        const decoded = Buffer.from(value, "base64");
        const key = createPublicKey({
          key: decoded,
          format: "der",
          type: "spki",
        });
        if (key.asymmetricKeyType !== "ed25519") {
          return false;
        }
        const canonicalDer = key.export({ format: "der", type: "spki" });
        return Buffer.isBuffer(canonicalDer) && canonicalDer.equals(decoded);
      } catch {
        return false;
      }
    },
    { message: "public key must be an Ed25519 SPKI DER key" },
  );

export interface AttestationEnvelope {
  readonly keyId: string;
  readonly signatureBase64: string;
}

export const AttestationEnvelopeSchema = z
  .object({
    keyId: z.string().min(1),
    signatureBase64: Ed25519SignatureBase64Schema,
  })
  .strict();
export const _attestationEnvelopeTypeBinding =
  AttestationEnvelopeSchema satisfies z.ZodType<AttestationEnvelope>;

export interface AgentLifecycleEvidencePayload {
  readonly specId: SpecId;
  readonly versionOrChannel: string;
  readonly state: LifecycleState;
  readonly assertedAt: string;
  readonly freshnessTtl: LifecycleEvidenceFreshnessTtl;
}

export const AgentLifecycleEvidencePayloadSchema = z
  .object({
    specId: SpecIdSchema,
    versionOrChannel: z.string().min(1),
    state: LifecycleStateSchema,
    assertedAt: Rfc3339WithOffsetSchema,
    freshnessTtl: LifecycleEvidenceFreshnessTtlSchema,
  })
  .strict();
export const _agentLifecycleEvidencePayloadTypeBinding =
  AgentLifecycleEvidencePayloadSchema satisfies z.ZodType<AgentLifecycleEvidencePayload>;

export interface AttestedAgentLifecycleEvidence {
  readonly payload: AgentLifecycleEvidencePayload;
  readonly attestation: AttestationEnvelope;
}

export const AttestedAgentLifecycleEvidenceSchema = z
  .object({
    payload: AgentLifecycleEvidencePayloadSchema,
    attestation: AttestationEnvelopeSchema,
  })
  .strict();
export const _attestedAgentLifecycleEvidenceTypeBinding =
  AttestedAgentLifecycleEvidenceSchema satisfies z.ZodType<AttestedAgentLifecycleEvidence>;

export interface AttestedRuntimeBindingEvidence {
  readonly payload: RuntimeBindingArtifact;
  readonly attestation: AttestationEnvelope;
}

export const AttestedRuntimeBindingEvidenceSchema = z
  .object({
    payload: RuntimeBindingArtifactSchema,
    attestation: AttestationEnvelopeSchema,
  })
  .strict();
export const _attestedRuntimeBindingEvidenceTypeBinding =
  AttestedRuntimeBindingEvidenceSchema satisfies z.ZodType<AttestedRuntimeBindingEvidence>;

export interface AttestedCallGraphEdgeApproval {
  readonly payload: DecidedCallGraphEdgeApproval;
  readonly attestation: AttestationEnvelope;
}

export const AttestedCallGraphEdgeApprovalSchema = z
  .object({
    payload: DecidedCallGraphEdgeApprovalSchema,
    attestation: AttestationEnvelopeSchema,
  })
  .strict();
export const _attestedCallGraphEdgeApprovalTypeBinding =
  AttestedCallGraphEdgeApprovalSchema satisfies z.ZodType<AttestedCallGraphEdgeApproval>;

/**
 * Signed Data Plane evidence for the acting run. The subject triple binds the
 * context to immutable AgentSpecContent; contentHash already commits to the
 * spec trust domain, so no second trust-domain field is introduced here.
 */
export interface RunContextEvidencePayload {
  readonly specId: SpecId;
  readonly version: string;
  readonly contentHash: string;
  readonly currentRunId: RunId;
  readonly callContext: CallContext;
  readonly assertedAt: string;
  readonly freshnessTtl: RunContextFreshnessTtl;
}

export const RunContextEvidencePayloadSchema = z
  .object({
    specId: SpecIdSchema,
    version: z.string().min(1),
    contentHash: z.string().min(1),
    currentRunId: RunIdSchema,
    callContext: CallContextSchema,
    assertedAt: Rfc3339WithOffsetSchema,
    freshnessTtl: RunContextFreshnessTtlSchema,
  })
  .strict();
export const _runContextEvidencePayloadTypeBinding =
  RunContextEvidencePayloadSchema satisfies z.ZodType<RunContextEvidencePayload>;

export interface AttestedRunContextEvidence {
  readonly payload: RunContextEvidencePayload;
  readonly attestation: AttestationEnvelope;
}

export const AttestedRunContextEvidenceSchema = z
  .object({
    payload: RunContextEvidencePayloadSchema,
    attestation: AttestationEnvelopeSchema,
  })
  .strict();
export const _attestedRunContextEvidenceTypeBinding =
  AttestedRunContextEvidenceSchema satisfies z.ZodType<AttestedRunContextEvidence>;

export interface TrustedAttestationKey {
  readonly keyId: string;
  readonly publicKeySpkiDerBase64: string;
  readonly allowedEvidenceKinds: ReadonlyArray<AttestationEvidenceKind>;
}

const AllowedEvidenceKindsSchema = z
  .array(AttestationEvidenceKindSchema)
  .min(1)
  .superRefine((evidenceKinds, ctx) => {
    const seenEvidenceKinds = new Set<AttestationEvidenceKind>();
    for (const evidenceKind of evidenceKinds) {
      if (seenEvidenceKinds.has(evidenceKind)) {
        ctx.addIssue({
          code: "custom",
          message: "allowed attestation evidence kinds must be unique",
        });
      }
      seenEvidenceKinds.add(evidenceKind);
    }
  });

export const TrustedAttestationKeySchema = z
  .object({
    keyId: z.string().min(1),
    publicKeySpkiDerBase64: Ed25519PublicKeySpkiDerBase64Schema,
    allowedEvidenceKinds: AllowedEvidenceKindsSchema,
  })
  .strict();
export const _trustedAttestationKeyTypeBinding =
  TrustedAttestationKeySchema satisfies z.ZodType<TrustedAttestationKey>;

export const TrustedAttestationKeysetSchema = z
  .array(TrustedAttestationKeySchema)
  .min(1)
  .superRefine((keys, ctx) => {
    const seenKeyIds = new Set<string>();
    for (const key of keys) {
      if (seenKeyIds.has(key.keyId)) {
        ctx.addIssue({
          code: "custom",
          message: "attestation keyIds must be unique",
        });
      }
      seenKeyIds.add(key.keyId);
    }
  });

export const LIFECYCLE_EVIDENCE_ROLES = ["acting", "callee"] as const;
export const LifecycleEvidenceRoleSchema = z.enum(LIFECYCLE_EVIDENCE_ROLES);
export type LifecycleEvidenceRole = z.infer<typeof LifecycleEvidenceRoleSchema>;

export const LIFECYCLE_FRESHNESS_CONDITIONS = ["from_future", "expired"] as const;
export const LifecycleFreshnessConditionSchema = z.enum(
  LIFECYCLE_FRESHNESS_CONDITIONS,
);
export type LifecycleFreshnessCondition = z.infer<
  typeof LifecycleFreshnessConditionSchema
>;

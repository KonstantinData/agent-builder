import { createHash } from "node:crypto";
import type { z } from "zod";
import { canonicalize } from "../assembler/content-hash.js";
import {
  AgentCallAuthorizationReservationBindingV1Schema,
  ReservationDigestSchema,
  type AgentCallAuthorizationReservationBindingV1,
  type ReservationDigest,
} from "../schema/agent-call-authorization-reservation.js";
import {
  RunContextEvidencePayloadSchema,
  type RunContextEvidencePayload,
} from "../schema/runtime-attestation.js";
import {
  AgentCallRuntimeActionSchema,
  AuthorizedChildRunContextDraftSchema,
  type AgentCallRuntimeAction,
  type AuthorizedChildRunContextDraft,
} from "../schema/runtime-authorization.js";

export const AGENT_CALL_RESERVATION_RUN_CONTEXT_DIGEST_DOMAIN =
  "agent-builder/digest/agent-call-reservation-run-context/v1";
export const AGENT_CALL_RESERVATION_ACTION_DIGEST_DOMAIN =
  "agent-builder/digest/agent-call-reservation-action/v1";
export const AGENT_CALL_RESERVATION_DRAFT_DIGEST_DOMAIN =
  "agent-builder/digest/agent-call-reservation-draft/v1";
export const AGENT_CALL_AUTHORIZATION_RESERVATION_DIGEST_DOMAIN =
  "agent-builder/digest/agent-call-authorization-reservation/v1";

function canonicalStrictJson<T>(schema: z.ZodType<T>, value: T): string {
  return JSON.stringify(canonicalize(schema.parse(value)));
}

function domainSeparatedDigest(domain: string, canonicalJson: string): ReservationDigest {
  return ReservationDigestSchema.parse(
    createHash("sha256").update(`${domain}\n${canonicalJson}`, "utf8").digest("hex"),
  );
}

export function computeAgentCallReservationRunContextDigest(
  payload: RunContextEvidencePayload,
): ReservationDigest {
  return domainSeparatedDigest(
    AGENT_CALL_RESERVATION_RUN_CONTEXT_DIGEST_DOMAIN,
    canonicalStrictJson(RunContextEvidencePayloadSchema, payload),
  );
}

export function computeAgentCallReservationActionDigest(
  action: AgentCallRuntimeAction,
): ReservationDigest {
  return domainSeparatedDigest(
    AGENT_CALL_RESERVATION_ACTION_DIGEST_DOMAIN,
    canonicalStrictJson(AgentCallRuntimeActionSchema, action),
  );
}

export function computeAgentCallReservationDraftDigest(
  draft: AuthorizedChildRunContextDraft,
): ReservationDigest {
  return domainSeparatedDigest(
    AGENT_CALL_RESERVATION_DRAFT_DIGEST_DOMAIN,
    canonicalStrictJson(AuthorizedChildRunContextDraftSchema, draft),
  );
}

export function canonicalAgentCallAuthorizationReservationBindingJson(
  binding: AgentCallAuthorizationReservationBindingV1,
): string {
  return canonicalStrictJson(AgentCallAuthorizationReservationBindingV1Schema, binding);
}

export function computeAgentCallAuthorizationReservationId(
  binding: AgentCallAuthorizationReservationBindingV1,
): ReservationDigest {
  return domainSeparatedDigest(
    AGENT_CALL_AUTHORIZATION_RESERVATION_DIGEST_DOMAIN,
    canonicalAgentCallAuthorizationReservationBindingJson(binding),
  );
}

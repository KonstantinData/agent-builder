import { z } from "zod";
import {
  AgentCallAuthorizationReservationRequestV1Schema,
  LocalAuthorizationReservationReceiptSchema,
  ReservationDigestSchema,
} from "./agent-call-authorization-reservation.js";
import { NoWildcardStringSchema } from "./common.js";
import { ApprovalDigestSchema, AuthorityRevisionSchema, EdgeSubjectV1Schema } from "./canonical-edge-authority.js";
import { RunIdSchema } from "./call-context.js";
import { Rfc3339WithOffsetSchema } from "./runtime-binding-validity.js";

/** Strict wire shapes only; this package ships neither a database nor a host implementation. */
export const PERSISTED_AUTHORIZATION_STORE_VERSION = "persisted-authorization-store/1" as const;

export const PersistedAuthorizationStoreScopeV1Schema = z.object({
  contractVersion: z.literal(PERSISTED_AUTHORIZATION_STORE_VERSION),
  tenantId: NoWildcardStringSchema,
}).strict();
export type PersistedAuthorizationStoreScopeV1 = z.infer<typeof PersistedAuthorizationStoreScopeV1Schema>;

/** Immutable evidence link, never a new authority decision. */
export const ParentDecisionLinkV1Schema = z.object({
  subject: EdgeSubjectV1Schema,
  expectedAuthorityRevision: AuthorityRevisionSchema,
  expectedApprovalDigest: ApprovalDigestSchema,
  currentRunId: RunIdSchema,
  runContextDigest: ReservationDigestSchema,
  reservationId: ReservationDigestSchema,
}).strict();
export type ParentDecisionLinkV1 = z.infer<typeof ParentDecisionLinkV1Schema>;

export const PersistedAuthorizationReservationRecordV1Schema = z.object({
  ...PersistedAuthorizationStoreScopeV1Schema.shape,
  parentDecision: ParentDecisionLinkV1Schema,
  receipt: LocalAuthorizationReservationReceiptSchema,
  recordedAt: Rfc3339WithOffsetSchema,
}).strict().superRefine((record, context) => {
  const receipt = record.receipt;
  const link = record.parentDecision;
  if (record.recordedAt !== receipt.reservedAt || link.reservationId !== receipt.reservationId || link.expectedAuthorityRevision !== receipt.expectedAuthorityRevision || link.expectedApprovalDigest !== receipt.expectedApprovalDigest || link.currentRunId !== receipt.currentRunId || link.runContextDigest !== receipt.runContextDigest || JSON.stringify(link.subject) !== JSON.stringify(receipt.subject)) {
    context.addIssue({ code: "custom", message: "parent decision link must exactly bind the stored receipt" });
  }
});
export type PersistedAuthorizationReservationRecordV1 = z.infer<typeof PersistedAuthorizationReservationRecordV1Schema>;

/** A readback is tenant-scoped before the reservation identifier is considered. */
export const PersistedAuthorizationReservationReadbackRequestV1Schema = z.object({
  ...PersistedAuthorizationStoreScopeV1Schema.shape,
  reservationId: ReservationDigestSchema,
}).strict();
export type PersistedAuthorizationReservationReadbackRequestV1 = z.infer<typeof PersistedAuthorizationReservationReadbackRequestV1Schema>;

export const PersistedAuthorizationReservationReadbackResultV1Schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("found"), record: PersistedAuthorizationReservationRecordV1Schema }).strict(),
  z.object({ kind: z.literal("absent"), observedAt: Rfc3339WithOffsetSchema }).strict(),
  z.object({ kind: z.literal("unavailable"), condition: z.literal("store_error") }).strict(),
]);
export type PersistedAuthorizationReservationReadbackResultV1 = z.infer<typeof PersistedAuthorizationReservationReadbackResultV1Schema>;

/** A separately trusted host injects this adapter; malformed or unknown results block. */
export type PersistedAuthorizationReservationReadbackAdapter = (request: PersistedAuthorizationReservationReadbackRequestV1) => Promise<unknown>;

export function parentDecisionLinkFromReservationRequest(input: unknown): ParentDecisionLinkV1 {
  const request = AgentCallAuthorizationReservationRequestV1Schema.parse(input);
  return ParentDecisionLinkV1Schema.parse({
    subject: request.subject,
    expectedAuthorityRevision: request.expectedAuthorityRevision,
    expectedApprovalDigest: request.expectedApprovalDigest,
    currentRunId: request.currentRunId,
    runContextDigest: request.runContextDigest,
    reservationId: request.reservationId,
  });
}

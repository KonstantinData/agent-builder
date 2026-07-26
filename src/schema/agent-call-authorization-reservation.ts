import { z } from "zod";
import { RunIdSchema } from "./call-context.js";
import {
  ApprovalDigestSchema,
  AuthorityRevisionSchema,
  EdgeSubjectV1Schema,
} from "./canonical-edge-authority.js";
import { Rfc3339WithOffsetSchema } from "./runtime-binding-validity.js";

export const ReservationDigestSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "reservation digest must be 64 lowercase hexadecimal characters");
export type ReservationDigest = z.infer<typeof ReservationDigestSchema>;

/**
 * A value-only budget snapshot carried to the injected reservation authority.
 * The Data Plane never persists or mutates this value itself.
 */
export const ParentBudgetSnapshotSchema = z
  .object({
    callBudget: z.number().int().nonnegative(),
    tokenBudget: z.number().int().nonnegative(),
    timeBudget: z.number().nonnegative(),
  })
  .strict();
export type ParentBudgetSnapshot = z.infer<typeof ParentBudgetSnapshotSchema>;

const AgentCallAuthorizationReservationBindingV1Fields = {
  subject: EdgeSubjectV1Schema,
  expectedAuthorityRevision: AuthorityRevisionSchema,
  expectedApprovalDigest: ApprovalDigestSchema,
  currentRunId: RunIdSchema,
  runContextDigest: ReservationDigestSchema,
  actionDigest: ReservationDigestSchema,
  childRunContextDraftDigest: ReservationDigestSchema,
  authorizationTime: Rfc3339WithOffsetSchema,
  authorizationValidUntilExclusive: Rfc3339WithOffsetSchema,
};

export const AgentCallAuthorizationReservationBindingV1Schema = z
  .object(AgentCallAuthorizationReservationBindingV1Fields)
  .strict();
export type AgentCallAuthorizationReservationBindingV1 = z.infer<
  typeof AgentCallAuthorizationReservationBindingV1Schema
>;

/**
 * Exact replay identity input for one parent-budget debit. The injected store
 * must treat this as an idempotency key and atomically protect all siblings
 * bound to the same signed parent context.
 */
export const ParentBudgetConsumptionBindingV1Schema = z
  .object({
    ...AgentCallAuthorizationReservationBindingV1Fields,
    parentBudgetBefore: ParentBudgetSnapshotSchema,
    childBudget: ParentBudgetSnapshotSchema,
  })
  .strict();
export type ParentBudgetConsumptionBindingV1 = z.infer<
  typeof ParentBudgetConsumptionBindingV1Schema
>;

export const AgentCallAuthorizationReservationRequestV1Schema = z
  .object({
    reservationId: ReservationDigestSchema,
    ...ParentBudgetConsumptionBindingV1Schema.shape,
  })
  .strict();
export type AgentCallAuthorizationReservationRequestV1 = z.infer<
  typeof AgentCallAuthorizationReservationRequestV1Schema
>;

export const LocalAuthorizationReservationReceiptSchema = z
  .object({
    reservationId: ReservationDigestSchema,
    ...ParentBudgetConsumptionBindingV1Schema.shape,
    reservedAt: Rfc3339WithOffsetSchema,
    parentBudgetConsumedTotal: ParentBudgetSnapshotSchema,
    parentBudgetRemaining: ParentBudgetSnapshotSchema,
  })
  .strict();
export type LocalAuthorizationReservationReceipt = z.infer<
  typeof LocalAuthorizationReservationReceiptSchema
>;

export const AgentCallAuthorizationReservationResultV1Schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("reserved"),
      receipt: LocalAuthorizationReservationReceiptSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("already_reserved"),
      receipt: LocalAuthorizationReservationReceiptSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("subject_absent"),
      observedAt: Rfc3339WithOffsetSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("authority_revoked"),
      observedAt: Rfc3339WithOffsetSchema,
      currentAuthorityRevision: AuthorityRevisionSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("authority_superseded"),
      observedAt: Rfc3339WithOffsetSchema,
      currentAuthorityRevision: AuthorityRevisionSchema,
      currentApprovalDigest: ApprovalDigestSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("authorization_window_expired"),
      observedAt: Rfc3339WithOffsetSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("parent_budget_exhausted"),
      observedAt: Rfc3339WithOffsetSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("replay_conflict"),
      observedAt: Rfc3339WithOffsetSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("unavailable"),
      condition: z.literal("store_error"),
    })
    .strict(),
]);
export type AgentCallAuthorizationReservationResultV1 = z.infer<
  typeof AgentCallAuthorizationReservationResultV1Schema
>;

export const AgentCallAuthorizationReservationTimeoutPolicySchema = z
  .object({
    timeoutMs: z.number().int().positive().max(2_147_483_647),
  })
  .strict();
export type AgentCallAuthorizationReservationTimeoutPolicy = z.infer<
  typeof AgentCallAuthorizationReservationTimeoutPolicySchema
>;

import { z } from "zod";
import { SpecIdSchema, TrustDomainIdSchema } from "./common.js";
import { Rfc3339WithOffsetSchema } from "./runtime-binding-validity.js";

export const EdgeSubjectV1Schema = z
  .object({
    callerSpecId: SpecIdSchema,
    callerVersion: z.string().min(1),
    calleeSpecId: SpecIdSchema,
    calleeVersionOrChannel: z.string().min(1),
    trustDomainId: TrustDomainIdSchema,
  })
  .strict();
export type EdgeSubjectV1 = z.infer<typeof EdgeSubjectV1Schema>;

export const ApprovalDigestSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "approval digest must be 64 lowercase hexadecimal characters");
export type ApprovalDigest = z.infer<typeof ApprovalDigestSchema>;

export const AuthorityStatusSchema = z.enum(["active", "revoked"]);
export type AuthorityStatus = z.infer<typeof AuthorityStatusSchema>;

export const AuthorityRevisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export type AuthorityRevision = z.infer<typeof AuthorityRevisionSchema>;

export const CanonicalAuthorityRecordV1Schema = z
  .object({
    subject: EdgeSubjectV1Schema,
    authorityRevision: AuthorityRevisionSchema,
    approvalDigest: ApprovalDigestSchema,
    status: AuthorityStatusSchema,
  })
  .strict();
export type CanonicalAuthorityRecordV1 = z.infer<typeof CanonicalAuthorityRecordV1Schema>;

export const CanonicalAuthorityLookupRequestV1Schema = z
  .object({
    subject: EdgeSubjectV1Schema,
    asOf: Rfc3339WithOffsetSchema,
  })
  .strict();
export type CanonicalAuthorityLookupRequestV1 = z.infer<
  typeof CanonicalAuthorityLookupRequestV1Schema
>;

const CanonicalAuthorityLookupObservationFields = {
  subject: EdgeSubjectV1Schema,
  asOf: Rfc3339WithOffsetSchema,
  observedAt: Rfc3339WithOffsetSchema,
};

export const CanonicalAuthorityLookupResultV1Schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("found"),
      ...CanonicalAuthorityLookupObservationFields,
      record: CanonicalAuthorityRecordV1Schema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("subject_absent"),
      ...CanonicalAuthorityLookupObservationFields,
    })
    .strict(),
  z
    .object({
      kind: z.literal("unavailable"),
      condition: z.enum(["timeout", "resolver_error", "response_untrustworthy"]),
    })
    .strict(),
]);
export type CanonicalAuthorityLookupResultV1 = z.infer<
  typeof CanonicalAuthorityLookupResultV1Schema
>;

export const CanonicalAuthorityLookupTimeoutPolicySchema = z
  .object({
    timeoutMs: z.number().int().positive().max(2_147_483_647),
  })
  .strict();
export type CanonicalAuthorityLookupTimeoutPolicy = z.infer<
  typeof CanonicalAuthorityLookupTimeoutPolicySchema
>;

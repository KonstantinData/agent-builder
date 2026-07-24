import { describe, expect, it } from "vitest";
import {
  ApprovalDigestSchema,
  AuthorityRevisionSchema,
  CanonicalAuthorityLookupResultV1Schema,
  CanonicalAuthorityLookupTimeoutPolicySchema,
  CanonicalAuthorityRecordV1Schema,
  EdgeSubjectV1Schema,
} from "../../src/schema/canonical-edge-authority.js";

const subject = EdgeSubjectV1Schema.parse({
  callerSpecId: "spec-crm-enricher",
  callerVersion: "1.0.0",
  calleeSpecId: "spec-web-search",
  calleeVersionOrChannel: "1.0.0",
  trustDomainId: "domain-sales",
});
const digest = "a".repeat(64);

describe("canonical edge authority schemas", () => {
  it("accepts strict found and subject-absent point-in-time results", () => {
    expect(
      CanonicalAuthorityLookupResultV1Schema.parse({
        kind: "found",
        subject,
        asOf: "2026-07-23T13:00:00Z",
        observedAt: "2026-07-23T13:00:01Z",
        record: {
          subject,
          authorityRevision: 2,
          approvalDigest: digest,
          status: "revoked",
        },
      }),
    ).toMatchObject({ kind: "found", record: { authorityRevision: 2, status: "revoked" } });

    expect(
      CanonicalAuthorityLookupResultV1Schema.safeParse({
        kind: "subject_absent",
        subject,
        asOf: "2026-07-23T13:00:00Z",
        observedAt: "2026-07-23T15:00:00+02:00",
      }).success,
    ).toBe(true);
  });

  it("pins lowercase SHA-256 shape and positive safe revisions", () => {
    expect(ApprovalDigestSchema.safeParse(digest).success).toBe(true);
    for (const invalid of ["A".repeat(64), "a".repeat(63), "g".repeat(64), ""]) {
      expect(ApprovalDigestSchema.safeParse(invalid).success).toBe(false);
    }

    expect(AuthorityRevisionSchema.safeParse(1).success).toBe(true);
    for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(AuthorityRevisionSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("rejects malformed records, timestamps, union shapes, and extra fields", () => {
    const validRecord = {
      subject,
      authorityRevision: 1,
      approvalDigest: digest,
      status: "active",
    };
    expect(CanonicalAuthorityRecordV1Schema.safeParse(validRecord).success).toBe(true);

    for (const invalid of [
      { ...validRecord, authorityRevision: 0 },
      { ...validRecord, status: "disabled" },
      { ...validRecord, approvalDigest: "A".repeat(64) },
      { ...validRecord, extra: true },
    ]) {
      expect(CanonicalAuthorityRecordV1Schema.safeParse(invalid).success).toBe(false);
    }

    for (const invalid of [
      { kind: "found", subject, asOf: "not-a-time", observedAt: "2026-07-23T13:00:00Z", record: validRecord },
      { kind: "subject_absent", subject, asOf: "2026-07-23T13:00:00Z" },
      { kind: "unavailable", condition: "network_details" },
      { kind: "unknown", condition: "timeout" },
      { kind: "unavailable", condition: "timeout", extra: true },
    ]) {
      expect(CanonicalAuthorityLookupResultV1Schema.safeParse(invalid).success).toBe(false);
    }
  });

  it("requires a strict, bounded positive timeout policy", () => {
    expect(CanonicalAuthorityLookupTimeoutPolicySchema.parse({ timeoutMs: 1 })).toEqual({
      timeoutMs: 1,
    });
    for (const invalid of [
      { timeoutMs: 0 },
      { timeoutMs: 1.5 },
      { timeoutMs: 2_147_483_648 },
      { timeoutMs: 100, extra: true },
    ]) {
      expect(CanonicalAuthorityLookupTimeoutPolicySchema.safeParse(invalid).success).toBe(false);
    }
  });
});

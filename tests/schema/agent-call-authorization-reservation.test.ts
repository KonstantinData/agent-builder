import { describe, expect, it } from "vitest";
import {
  AgentCallAuthorizationReservationBindingV1Schema,
  AgentCallAuthorizationReservationRequestV1Schema,
  AgentCallAuthorizationReservationResultV1Schema,
  AgentCallAuthorizationReservationTimeoutPolicySchema,
  LocalAuthorizationReservationReceiptSchema,
} from "../../src/schema/agent-call-authorization-reservation.js";

const digest = "a".repeat(64);
const binding = AgentCallAuthorizationReservationBindingV1Schema.parse({
  subject: {
    callerSpecId: "spec-crm-enricher",
    callerVersion: "1.0.0",
    calleeSpecId: "spec-web-search",
    calleeVersionOrChannel: "1.0.0",
    trustDomainId: "domain-sales",
  },
  expectedAuthorityRevision: 3,
  expectedApprovalDigest: "b".repeat(64),
  currentRunId: "run-current",
  runContextDigest: digest,
  actionDigest: digest,
  childRunContextDraftDigest: digest,
  authorizationTime: "2026-07-23T13:00:00Z",
  authorizationValidUntilExclusive: "2026-07-23T13:04:00.000Z",
});

const request = {
  reservationId: "c".repeat(64),
  ...binding,
};

const receipt = {
  ...request,
  reservedAt: "2026-07-23T13:00:01Z",
};

describe("agent-call authorization reservation schemas", () => {
  it("accepts strict binding, request, receipt, and closed result variants", () => {
    expect(AgentCallAuthorizationReservationRequestV1Schema.parse(request)).toEqual(request);
    expect(LocalAuthorizationReservationReceiptSchema.parse(receipt)).toEqual(receipt);

    for (const result of [
      { kind: "reserved", receipt },
      { kind: "already_reserved", receipt },
      { kind: "subject_absent", observedAt: "2026-07-23T13:00:01Z" },
      {
        kind: "authority_revoked",
        observedAt: "2026-07-23T13:00:01Z",
        currentAuthorityRevision: 4,
      },
      {
        kind: "authority_superseded",
        observedAt: "2026-07-23T13:00:01Z",
        currentAuthorityRevision: 4,
        currentApprovalDigest: "d".repeat(64),
      },
      {
        kind: "authorization_window_expired",
        observedAt: "2026-07-23T13:04:00Z",
      },
      { kind: "unavailable", condition: "store_error" },
    ]) {
      expect(AgentCallAuthorizationReservationResultV1Schema.safeParse(result).success).toBe(true);
    }
  });

  it("rejects caller drift, malformed digests, revisions, timestamps, and extra fields", () => {
    for (const invalid of [
      { ...request, reservationId: "A".repeat(64) },
      { ...request, expectedAuthorityRevision: 0 },
      { ...request, authorizationTime: "not-a-time" },
      { ...request, extra: true },
    ]) {
      expect(AgentCallAuthorizationReservationRequestV1Schema.safeParse(invalid).success).toBe(
        false,
      );
    }

    for (const invalid of [
      { kind: "reserved", receipt: { ...receipt, extra: true } },
      { kind: "subject_absent" },
      { kind: "authority_revoked", observedAt: receipt.reservedAt, currentAuthorityRevision: 0 },
      {
        kind: "authority_superseded",
        observedAt: receipt.reservedAt,
        currentAuthorityRevision: 4,
        currentApprovalDigest: "A".repeat(64),
      },
      { kind: "unavailable", condition: "timeout" },
      { kind: "unknown" },
    ]) {
      expect(AgentCallAuthorizationReservationResultV1Schema.safeParse(invalid).success).toBe(
        false,
      );
    }
  });

  it("requires a strict bounded positive timeout policy", () => {
    expect(AgentCallAuthorizationReservationTimeoutPolicySchema.parse({ timeoutMs: 1 })).toEqual({
      timeoutMs: 1,
    });
    for (const invalid of [
      { timeoutMs: 0 },
      { timeoutMs: 1.5 },
      { timeoutMs: 2_147_483_648 },
      { timeoutMs: 10, extra: true },
    ]) {
      expect(
        AgentCallAuthorizationReservationTimeoutPolicySchema.safeParse(invalid).success,
      ).toBe(false);
    }
  });
});

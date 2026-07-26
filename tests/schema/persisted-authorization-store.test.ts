import { describe, expect, it } from "vitest";
import { parentDecisionLinkFromReservationRequest, PersistedAuthorizationReservationReadbackResultV1Schema, PersistedAuthorizationReservationRecordV1Schema } from "../../src/schema/persisted-authorization-store.js";

const request = { reservationId: "c".repeat(64), subject: { callerSpecId: "caller", callerVersion: "1", calleeSpecId: "callee", calleeVersionOrChannel: "1", trustDomainId: "domain" }, expectedAuthorityRevision: 3, expectedApprovalDigest: "b".repeat(64), currentRunId: "run-parent", runContextDigest: "a".repeat(64), actionDigest: "d".repeat(64), childRunContextDraftDigest: "e".repeat(64), authorizationTime: "2026-07-26T18:00:00.000Z", authorizationValidUntilExclusive: "2026-07-26T18:04:00.000Z", parentBudgetBefore: { callBudget: 2, tokenBudget: 10, timeBudget: 20 }, childBudget: { callBudget: 1, tokenBudget: 5, timeBudget: 10 } };
const receipt = { ...request, reservedAt: "2026-07-26T18:00:01.000Z", parentBudgetConsumedTotal: { callBudget: 1, tokenBudget: 5, timeBudget: 10 }, parentBudgetRemaining: { callBudget: 1, tokenBudget: 5, timeBudget: 10 } };
const record = { contractVersion: "persisted-authorization-store/1", tenantId: "tenant-a", parentDecision: parentDecisionLinkFromReservationRequest(request), receipt, recordedAt: receipt.reservedAt };

describe("persisted authorization store contract", () => {
  it("binds a scoped readback record exactly to its parent decision and receipt", () => {
    expect(PersistedAuthorizationReservationRecordV1Schema.parse(record)).toEqual(record);
    expect(PersistedAuthorizationReservationReadbackResultV1Schema.parse({ kind: "found", record })).toEqual({ kind: "found", record });
  });
  it("rejects linkage drift, wildcard tenants, and untrusted readback variants", () => {
    for (const invalid of [{ ...record, tenantId: "tenant-*" }, { ...record, recordedAt: request.authorizationTime }, { ...record, parentDecision: { ...record.parentDecision, currentRunId: "other-run" } }, { ...record, receipt: { ...receipt, reservationId: "f".repeat(64) } }]) expect(PersistedAuthorizationReservationRecordV1Schema.safeParse(invalid).success).toBe(false);
    for (const invalid of [{ kind: "found", record: { ...record, extra: true } }, { kind: "absent" }, { kind: "unavailable", condition: "timeout" }, { kind: "unknown" }]) expect(PersistedAuthorizationReservationReadbackResultV1Schema.safeParse(invalid).success).toBe(false);
  });
});

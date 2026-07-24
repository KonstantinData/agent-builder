import { describe, expect, it } from "vitest";
import {
  AGENT_CALL_AUTHORIZATION_RESERVATION_DIGEST_DOMAIN,
  AGENT_CALL_RESERVATION_ACTION_DIGEST_DOMAIN,
  AGENT_CALL_RESERVATION_DRAFT_DIGEST_DOMAIN,
  AGENT_CALL_RESERVATION_RUN_CONTEXT_DIGEST_DOMAIN,
  canonicalAgentCallAuthorizationReservationBindingJson,
  computeAgentCallAuthorizationReservationId,
  computeAgentCallReservationActionDigest,
  computeAgentCallReservationDraftDigest,
  computeAgentCallReservationRunContextDigest,
} from "../../src/runtime/agent-call-reservation-digest.js";
import { AgentCallAuthorizationReservationBindingV1Schema } from "../../src/schema/agent-call-authorization-reservation.js";
import { RunContextEvidencePayloadSchema } from "../../src/schema/runtime-attestation.js";
import {
  AgentCallRuntimeActionSchema,
  AuthorizedChildRunContextDraftSchema,
} from "../../src/schema/runtime-authorization.js";

const runContext = RunContextEvidencePayloadSchema.parse({
  specId: "spec-crm-enricher",
  version: "1.0.0",
  contentHash: "sha256:spec",
  currentRunId: "run-current",
  callContext: {
    rootRunId: "run-root",
    parentRunId: "run-parent",
    callChain: ["spec-crm-enricher"],
    remainingDepth: 2,
    remainingCallBudget: 3,
    remainingTokenBudget: 20_000,
    remainingTimeBudget: 30_000,
  },
  assertedAt: "2026-07-23T12:59:00Z",
  freshnessTtl: 300,
});

const action = AgentCallRuntimeActionSchema.parse({
  type: "agent_call",
  calleeSpecId: "spec-web-search",
  calleeVersionOrChannel: "1.0.0",
  intent: "query",
  childBudget: { callBudget: 1, tokenBudget: 5_000, timeBudget: 10_000 },
});

const draft = AuthorizedChildRunContextDraftSchema.parse({
  calleeSpecId: "spec-web-search",
  calleeVersionOrChannel: "1.0.0",
  callContext: {
    rootRunId: "run-root",
    parentRunId: "run-current",
    callChain: ["spec-crm-enricher", "spec-web-search"],
    remainingDepth: 0,
    remainingCallBudget: 1,
    remainingTokenBudget: 5_000,
    remainingTimeBudget: 10_000,
  },
});

const binding = AgentCallAuthorizationReservationBindingV1Schema.parse({
  subject: {
    callerSpecId: "spec-crm-enricher",
    callerVersion: "1.0.0",
    calleeSpecId: "spec-web-search",
    calleeVersionOrChannel: "1.0.0",
    trustDomainId: "domain-sales",
  },
  expectedAuthorityRevision: 3,
  expectedApprovalDigest: "a".repeat(64),
  currentRunId: "run-current",
  runContextDigest: computeAgentCallReservationRunContextDigest(runContext),
  actionDigest: computeAgentCallReservationActionDigest(action),
  childRunContextDraftDigest: computeAgentCallReservationDraftDigest(draft),
  authorizationTime: "2026-07-23T13:00:00Z",
  authorizationValidUntilExclusive: "2026-07-23T13:04:00.000Z",
});

describe("agent-call authorization reservation digests", () => {
  it("pins repository-style domains and a deterministic reservation vector", () => {
    expect(AGENT_CALL_RESERVATION_RUN_CONTEXT_DIGEST_DOMAIN).toBe(
      "agent-builder/digest/agent-call-reservation-run-context/v1",
    );
    expect(AGENT_CALL_RESERVATION_ACTION_DIGEST_DOMAIN).toBe(
      "agent-builder/digest/agent-call-reservation-action/v1",
    );
    expect(AGENT_CALL_RESERVATION_DRAFT_DIGEST_DOMAIN).toBe(
      "agent-builder/digest/agent-call-reservation-draft/v1",
    );
    expect(AGENT_CALL_AUTHORIZATION_RESERVATION_DIGEST_DOMAIN).toBe(
      "agent-builder/digest/agent-call-authorization-reservation/v1",
    );
    expect(computeAgentCallAuthorizationReservationId(binding)).toBe(
      "5dda7cf182f530b7d8230c671b9ffe474561498e1616fe8a7c196cc5bae7b84c",
    );
  });

  it("is insertion-order invariant and binds every logical input", () => {
    const reordered = AgentCallAuthorizationReservationBindingV1Schema.parse({
      authorizationValidUntilExclusive: binding.authorizationValidUntilExclusive,
      authorizationTime: binding.authorizationTime,
      childRunContextDraftDigest: binding.childRunContextDraftDigest,
      actionDigest: binding.actionDigest,
      runContextDigest: binding.runContextDigest,
      currentRunId: binding.currentRunId,
      expectedApprovalDigest: binding.expectedApprovalDigest,
      expectedAuthorityRevision: binding.expectedAuthorityRevision,
      subject: { ...binding.subject },
    });
    expect(canonicalAgentCallAuthorizationReservationBindingJson(reordered)).toBe(
      canonicalAgentCallAuthorizationReservationBindingJson(binding),
    );
    expect(computeAgentCallAuthorizationReservationId(reordered)).toBe(
      computeAgentCallAuthorizationReservationId(binding),
    );

    for (const mutation of [
      { ...binding, expectedAuthorityRevision: 4 },
      { ...binding, currentRunId: "run-other" },
      { ...binding, actionDigest: "b".repeat(64) },
      { ...binding, authorizationTime: "2026-07-23T13:00:01Z" },
      {
        ...binding,
        authorizationValidUntilExclusive: "2026-07-23T13:03:59.999Z",
      },
    ]) {
      expect(
        computeAgentCallAuthorizationReservationId(
          AgentCallAuthorizationReservationBindingV1Schema.parse(mutation),
        ),
      ).not.toBe(computeAgentCallAuthorizationReservationId(binding));
    }
  });
});

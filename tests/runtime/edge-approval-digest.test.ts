import { describe, expect, it } from "vitest";
import { DecidedCallGraphEdgeApprovalSchema } from "../../src/schema/approval-artifact.js";
import {
  CALL_GRAPH_EDGE_APPROVAL_DECISION_DIGEST_DOMAIN,
  canonicalCallGraphEdgeApprovalDecisionJson,
  computeCallGraphEdgeApprovalDecisionDigest,
  createCallGraphEdgeApprovalDecisionDigestPreimage,
} from "../../src/runtime/edge-approval-digest.js";

const decision = DecidedCallGraphEdgeApprovalSchema.parse({
  type: "call_graph_edge",
  artifactId: "approval-edge-001",
  requestedBy: "builder-agent",
  decision: "approved",
  decidedBy: "policy-harness",
  decidedAt: "2026-07-23T12:00:00Z",
  edge: {
    callerSpecId: "spec-crm-enricher",
    callerVersion: "1.0.0",
    calleeSpecId: "spec-web-search",
    calleeVersionOrChannel: "1.0.0",
    allowedIntents: ["query"],
    dataShareScope: "tenant:acme:crm",
    maxDepth: 1,
    maxCallsPerRun: 3,
    maxCallsPerTimeWindow: 100,
    requiresHumanGate: false,
    trustDomainId: "domain-sales",
  },
});

describe("call-graph edge approval decision digest", () => {
  it("pins the domain, canonical decision bytes, and independent SHA-256 vector", () => {
    const canonicalJson =
      '{"artifactId":"approval-edge-001","decidedAt":"2026-07-23T12:00:00Z","decidedBy":"policy-harness","decision":"approved","edge":{"allowedIntents":["query"],"calleeSpecId":"spec-web-search","calleeVersionOrChannel":"1.0.0","callerSpecId":"spec-crm-enricher","callerVersion":"1.0.0","dataShareScope":"tenant:acme:crm","maxCallsPerRun":3,"maxCallsPerTimeWindow":100,"maxDepth":1,"requiresHumanGate":false,"trustDomainId":"domain-sales"},"requestedBy":"builder-agent","type":"call_graph_edge"}';
    expect(CALL_GRAPH_EDGE_APPROVAL_DECISION_DIGEST_DOMAIN).toBe(
      "agent-builder/digest/call-graph-edge-approval/v1",
    );
    expect(canonicalCallGraphEdgeApprovalDecisionJson(decision)).toBe(canonicalJson);
    expect(createCallGraphEdgeApprovalDecisionDigestPreimage(decision).toString("utf8")).toBe(
      `${CALL_GRAPH_EDGE_APPROVAL_DECISION_DIGEST_DOMAIN}\n${canonicalJson}`,
    );
    expect(computeCallGraphEdgeApprovalDecisionDigest(decision)).toBe(
      "0ada6db1040dd0292ddc4cff1ded88833f2801e083f69e9811ed788e1995c40a",
    );
  });

  it("is insertion-order invariant but binds every decision and edge field", () => {
    const reordered = DecidedCallGraphEdgeApprovalSchema.parse({
      edge: { ...decision.edge },
      decidedAt: decision.decidedAt,
      decidedBy: decision.decidedBy,
      decision: decision.decision,
      requestedBy: decision.requestedBy,
      artifactId: decision.artifactId,
      type: decision.type,
    });
    expect(computeCallGraphEdgeApprovalDecisionDigest(reordered)).toBe(
      computeCallGraphEdgeApprovalDecisionDigest(decision),
    );

    const mutations = [
      { ...decision, artifactId: "approval-edge-002" },
      { ...decision, decidedAt: "2026-07-23T12:00:01Z" },
      { ...decision, reason: "changed" },
      { ...decision, edge: { ...decision.edge, maxDepth: 2 } },
      { ...decision, edge: { ...decision.edge, requiresHumanGate: true } },
    ].map((candidate) => DecidedCallGraphEdgeApprovalSchema.parse(candidate));

    for (const mutation of mutations) {
      expect(computeCallGraphEdgeApprovalDecisionDigest(mutation)).not.toBe(
        computeCallGraphEdgeApprovalDecisionDigest(decision),
      );
    }
  });

  it("keeps equivalent instants with different RFC-3339 bytes digest-distinct", () => {
    const offset = DecidedCallGraphEdgeApprovalSchema.parse({
      ...decision,
      decidedAt: "2026-07-23T14:00:00+02:00",
    });
    expect(Date.parse(offset.decidedAt)).toBe(Date.parse(decision.decidedAt));
    expect(computeCallGraphEdgeApprovalDecisionDigest(offset)).not.toBe(
      computeCallGraphEdgeApprovalDecisionDigest(decision),
    );
  });
});

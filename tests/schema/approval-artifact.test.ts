import { describe, expect, it } from "vitest";
import {
  AgentSpecApprovalSchema,
  ApprovalArtifactSchema,
  DecidedCallGraphEdgeApprovalSchema,
} from "../../src/schema/approval-artifact.js";
import { edgeAToB } from "../fixtures/specs.js";

describe("ApprovalArtifactSchema", () => {
  it("accepts an agent_spec approval artifact bound to a contentHash and evidence", () => {
    const candidate = {
      type: "agent_spec",
      artifactId: "approval-001",
      requestedBy: "builder-agent",
      decision: "approved",
      decidedBy: "release-manager",
      decidedAt: "2026-07-23T12:00:00Z",
      specId: "spec-crm-enricher",
      version: "1.0.0",
      contentHash: "hash-v1",
      evidence: {
        policyOutcome: "approved_pending_gate",
        delta: "initial",
        evaluationRef: { suiteRef: "suite-crm-v1", score: 0.95 },
      },
    };
    expect(ApprovalArtifactSchema.safeParse(candidate).success).toBe(true);
  });

  it("rejects an agent_spec approval artifact missing its contentHash subject binding", () => {
    const candidate = {
      type: "agent_spec",
      artifactId: "approval-001b",
      requestedBy: "builder-agent",
      decision: "approved",
      specId: "spec-crm-enricher",
      version: "1.0.0",
      evidence: { policyOutcome: "approved_pending_gate", delta: "capability-reducing" },
    };
    expect(ApprovalArtifactSchema.safeParse(candidate).success).toBe(false);
  });

  it("rejects an evidence carrying an unknown policy-rejection reason code", () => {
    const candidate = {
      type: "agent_spec",
      artifactId: "approval-001c",
      requestedBy: "builder-agent",
      decision: "rejected",
      specId: "spec-crm-enricher",
      version: "1.0.0",
      contentHash: "hash-v1",
      evidence: { policyOutcome: "rejected", rejectionReasonCodes: ["not_a_real_code"] },
    };
    expect(ApprovalArtifactSchema.safeParse(candidate).success).toBe(false);
  });

  it("rejects when decision and evidence.policyOutcome disagree", () => {
    const candidate = {
      type: "agent_spec",
      artifactId: "approval-001d",
      requestedBy: "builder-agent",
      decision: "approved",
      specId: "spec-crm-enricher",
      version: "1.0.0",
      contentHash: "hash-v1",
      evidence: { policyOutcome: "rejected", rejectionReasonCodes: ["evaluation_below_threshold"] },
    };
    expect(ApprovalArtifactSchema.safeParse(candidate).success).toBe(false);
  });

  it("rejects a rejected evidence with no reason codes", () => {
    const candidate = {
      type: "agent_spec",
      artifactId: "approval-001e",
      requestedBy: "builder-agent",
      decision: "rejected",
      specId: "spec-crm-enricher",
      version: "1.0.0",
      contentHash: "hash-v1",
      evidence: { policyOutcome: "rejected", rejectionReasonCodes: [] },
    };
    expect(ApprovalArtifactSchema.safeParse(candidate).success).toBe(false);
  });

  it("rejects an approved evidence that smuggles in rejection reason codes", () => {
    const candidate = {
      type: "agent_spec",
      artifactId: "approval-001f",
      requestedBy: "builder-agent",
      decision: "approved",
      specId: "spec-crm-enricher",
      version: "1.0.0",
      contentHash: "hash-v1",
      evidence: {
        policyOutcome: "approved_pending_gate",
        delta: "initial",
        rejectionReasonCodes: ["evaluation_below_threshold"],
      },
    };
    expect(ApprovalArtifactSchema.safeParse(candidate).success).toBe(false);
  });

  it("rejects a `pending` decision on an agent_spec (a decided gate output only)", () => {
    const candidate = {
      type: "agent_spec",
      artifactId: "approval-001g",
      requestedBy: "builder-agent",
      decision: "pending",
      specId: "spec-crm-enricher",
      version: "1.0.0",
      contentHash: "hash-v1",
      evidence: { policyOutcome: "approved_pending_gate", delta: "initial", evaluationRef: { suiteRef: "s", score: 0.9 } },
    };
    expect(ApprovalArtifactSchema.safeParse(candidate).success).toBe(false);
  });

  it("enforces the decision/policyOutcome invariant directly on AgentSpecApprovalSchema (no standalone blindspot)", () => {
    const mismatched = {
      type: "agent_spec",
      artifactId: "approval-001h",
      requestedBy: "builder-agent",
      decision: "approved",
      specId: "spec-crm-enricher",
      version: "1.0.0",
      contentHash: "hash-v1",
      evidence: { policyOutcome: "rejected", rejectionReasonCodes: ["evaluation_below_threshold"] },
    };
    expect(AgentSpecApprovalSchema.safeParse(mismatched).success).toBe(false);

    const coherent = {
      ...mismatched,
      decision: "rejected",
    };
    expect(AgentSpecApprovalSchema.safeParse(coherent).success).toBe(true);
  });

  it("requires an evaluationRef for an initial/expanding approved evidence, persistably", () => {
    const initialNoEval = {
      type: "agent_spec",
      artifactId: "approval-001i",
      requestedBy: "builder-agent",
      decision: "approved",
      specId: "spec-crm-enricher",
      version: "1.0.0",
      contentHash: "hash-v1",
      evidence: { policyOutcome: "approved_pending_gate", delta: "initial" },
    };
    expect(ApprovalArtifactSchema.safeParse(initialNoEval).success).toBe(false);
  });

  it("leaves evaluationRef optional for a capability-reducing approved evidence", () => {
    const reducingNoEval = {
      type: "agent_spec",
      artifactId: "approval-001j",
      requestedBy: "builder-agent",
      decision: "approved",
      specId: "spec-crm-enricher",
      version: "1.0.0",
      contentHash: "hash-v1",
      evidence: { policyOutcome: "approved_pending_gate", delta: "capability-reducing" },
    };
    expect(ApprovalArtifactSchema.safeParse(reducingNoEval).success).toBe(true);
  });

  it("accepts a call_graph_edge approval artifact wrapping a resolved edge", () => {
    const candidate = {
      type: "call_graph_edge",
      artifactId: "approval-002",
      requestedBy: "builder-agent",
      decision: "approved",
      decidedBy: "policy-harness",
      decidedAt: "2026-07-20T10:10:00Z",
      edge: edgeAToB,
    };
    expect(ApprovalArtifactSchema.safeParse(candidate).success).toBe(true);
  });

  it("rejects an artifact type outside the four known variants", () => {
    const candidate = {
      type: "budget_override",
      artifactId: "approval-003",
      requestedBy: "builder-agent",
      decision: "pending",
    };
    expect(ApprovalArtifactSchema.safeParse(candidate).success).toBe(false);
  });
});

describe("DecidedCallGraphEdgeApprovalSchema", () => {
  const decidedEdgeApproval = {
    type: "call_graph_edge",
    artifactId: "approval-edge-decided-001",
    requestedBy: "builder-agent",
    decision: "approved",
    decidedBy: "policy-harness",
    decidedAt: "2026-07-23T12:00:00Z",
    edge: edgeAToB,
  } as const;

  it.each(["approved", "rejected"] as const)(
    "accepts a complete `%s` runtime decision",
    (decision) => {
      expect(
        DecidedCallGraphEdgeApprovalSchema.safeParse({
          ...decidedEdgeApproval,
          decision,
        }).success,
      ).toBe(true);
    },
  );

  it("rejects pending, incomplete, ambiguous, and non-strict decisions", () => {
    for (const candidate of [
      { ...decidedEdgeApproval, decision: "pending" },
      { ...decidedEdgeApproval, decidedBy: undefined },
      { ...decidedEdgeApproval, decidedBy: "" },
      { ...decidedEdgeApproval, decidedAt: undefined },
      { ...decidedEdgeApproval, decidedAt: "2026-07-23T12:00:00" },
      { ...decidedEdgeApproval, reason: "" },
      { ...decidedEdgeApproval, reason: null },
      { ...decidedEdgeApproval, extra: "field" },
    ]) {
      expect(DecidedCallGraphEdgeApprovalSchema.safeParse(candidate).success).toBe(false);
    }
  });

  it("accepts explicit offsets and treats an omitted reason as optional", () => {
    expect(
      DecidedCallGraphEdgeApprovalSchema.safeParse({
        ...decidedEdgeApproval,
        decidedAt: "2026-07-23T14:00:00+02:00",
        reason: undefined,
      }).success,
    ).toBe(true);
  });
});

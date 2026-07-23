import { describe, expect, it } from "vitest";
import { runDeploymentGate } from "../../src/gate/run-deployment-gate.js";
import type { TrustedDecisionContext } from "../../src/gate/gate-types.js";
import { ApprovalArtifactSchema } from "../../src/schema/approval-artifact.js";
import {
  AgentSpecRuntimeMetadataSchema,
  type AgentSpecRuntimeMetadata,
  type LifecycleState,
} from "../../src/schema/agent-spec-runtime-metadata.js";
import type { PolicyEvaluationResult, PolicySubject } from "../../src/harness/harness-types.js";
import { validAgentSpecContent } from "../fixtures/specs.js";
import { makeTestPrincipal } from "../support/approval-principal.js";

function metadataInState(state: LifecycleState): AgentSpecRuntimeMetadata {
  return AgentSpecRuntimeMetadataSchema.parse({
    specId: "spec-crm-enricher",
    version: "1.0.0",
    state,
    stateHistory: [
      { state: "draft", actor: "builder-agent", timestamp: "2026-07-20T10:00:00Z", reason: "initial draft" },
      { state: "in_review", actor: "policy-harness", timestamp: "2026-07-20T10:05:00Z", reason: "schema validated" },
    ],
    requestor: "builder-agent",
  });
}

const inReviewMetadata = metadataInState("in_review");

// Distinct from the requestor ("builder-agent") so separation of duties holds.
const ctx: TrustedDecisionContext = {
  principal: makeTestPrincipal("release-manager"),
  decidedAt: "2026-07-23T12:00:00Z",
  artifactId: "approval-crm-enricher-001",
};

const subject: PolicySubject = { specId: validAgentSpecContent.specId, version: "1.0.0", contentHash: "hash-v1" };

const approvedInitialPolicy: PolicyEvaluationResult = {
  outcome: "approved_pending_gate",
  subject,
  delta: "initial",
  evaluation: { suiteRef: "suite-crm-v1", score: 0.95 },
};
const approvedReducingPolicy: PolicyEvaluationResult = {
  outcome: "approved_pending_gate",
  subject,
  delta: "capability-reducing",
};
const expandingWithoutEvalPolicy: PolicyEvaluationResult = {
  outcome: "approved_pending_gate",
  subject,
  delta: "capability-expanding",
};
const rejectedPolicy: PolicyEvaluationResult = {
  outcome: "rejected",
  subject,
  reasons: [{ type: "evaluation_below_threshold", score: 0.5, passThreshold: 0.9 }],
};
const rejectedWithEvalPolicy: PolicyEvaluationResult = {
  outcome: "rejected",
  subject,
  reasons: [{ type: "evaluation_below_threshold", score: 0.5, passThreshold: 0.9 }],
  evaluation: { suiteRef: "suite-crm-v1", score: 0.5 },
};
const evalRequiredPolicy: PolicyEvaluationResult = { outcome: "evaluation_required", subject };

describe("runDeploymentGate", () => {
  it("approves a gateable spec: emits a schema-valid agent_spec artifact bound to contentHash + evidence, and transitions to `approved`", () => {
    const result = runDeploymentGate(validAgentSpecContent, inReviewMetadata, approvedInitialPolicy, ctx);

    expect(result.outcome).toBe("approved");
    if (result.outcome !== "approved") return;

    expect(result.approval).toEqual({
      type: "agent_spec",
      artifactId: "approval-crm-enricher-001",
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
    });
    // The emitted artifact must satisfy the persisted schema.
    expect(ApprovalArtifactSchema.safeParse(result.approval).success).toBe(true);
    expect(result.metadata.state).toBe("approved");
  });

  it("approves a capability-reducing delta with no held evaluation and omits evaluationRef from evidence", () => {
    const result = runDeploymentGate(validAgentSpecContent, inReviewMetadata, approvedReducingPolicy, ctx);
    if (result.outcome !== "approved") throw new Error("expected approved");

    expect(result.approval.type).toBe("agent_spec");
    if (result.approval.type !== "agent_spec") return;
    expect(result.approval.evidence).toEqual({
      policyOutcome: "approved_pending_gate",
      delta: "capability-reducing",
    });
  });

  it("fails closed: an expanding verdict without held evaluation is blocked, never approved", () => {
    const result = runDeploymentGate(validAgentSpecContent, inReviewMetadata, expandingWithoutEvalPolicy, ctx);
    expect(result).toEqual({
      outcome: "blocked",
      reason: { type: "evaluation_evidence_missing", delta: "capability-expanding" },
    });
  });

  it("rejects when the policy rejected: transitions to `rejected`, stores reason codes, carries structured reasons", () => {
    const result = runDeploymentGate(validAgentSpecContent, inReviewMetadata, rejectedPolicy, ctx);

    expect(result.outcome).toBe("rejected");
    if (result.outcome !== "rejected") return;

    expect(result.metadata.state).toBe("rejected");
    expect(result.approval.decision).toBe("rejected");
    if (result.approval.type !== "agent_spec") throw new Error("expected agent_spec");
    expect(result.approval.evidence).toEqual({
      policyOutcome: "rejected",
      rejectionReasonCodes: ["evaluation_below_threshold"],
    });
    expect(result.reason).toEqual({
      type: "policy_rejected",
      reasons: [{ type: "evaluation_below_threshold", score: 0.5, passThreshold: 0.9 }],
    });
  });

  it("persists the held evaluation as evidence.evaluationRef when the rejection came from an evaluation", () => {
    const result = runDeploymentGate(validAgentSpecContent, inReviewMetadata, rejectedWithEvalPolicy, ctx);
    if (result.outcome !== "rejected") throw new Error("expected rejected");
    if (result.approval.type !== "agent_spec") throw new Error("expected agent_spec");

    expect(result.approval.evidence).toEqual({
      policyOutcome: "rejected",
      rejectionReasonCodes: ["evaluation_below_threshold"],
      evaluationRef: { suiteRef: "suite-crm-v1", score: 0.5 },
    });
    // A rejected gate output must still satisfy the persisted schema.
    expect(ApprovalArtifactSchema.safeParse(result.approval).success).toBe(true);
  });

  it("blocks (never approves) when evaluation is still required and leaves lifecycle state untouched", () => {
    const result = runDeploymentGate(validAgentSpecContent, inReviewMetadata, evalRequiredPolicy, ctx);
    expect(result).toEqual({ outcome: "blocked", reason: { type: "evaluation_required" } });
    expect("metadata" in result).toBe(false);
  });

  it("appends exactly one state-history entry recording the attested principal, timestamp, and reason", () => {
    const result = runDeploymentGate(validAgentSpecContent, inReviewMetadata, approvedInitialPolicy, {
      ...ctx,
      reason: "signed off in change board",
    });
    if (result.outcome !== "approved") throw new Error("expected approved");

    expect(result.metadata.stateHistory).toHaveLength(inReviewMetadata.stateHistory.length + 1);
    expect(result.metadata.stateHistory.at(-1)).toEqual({
      state: "approved",
      actor: "release-manager",
      timestamp: "2026-07-23T12:00:00Z",
      reason: "signed off in change board",
    });
  });

  it("synthesizes a non-empty history reason when the context omits one", () => {
    const result = runDeploymentGate(validAgentSpecContent, inReviewMetadata, approvedInitialPolicy, ctx);
    if (result.outcome !== "approved") throw new Error("expected approved");
    const reason = result.metadata.stateHistory.at(-1)?.reason ?? "";
    expect(reason.length).toBeGreaterThan(0);
    expect(reason).toContain("initial");
  });

  it("enforces separation of duties: the requestor cannot approve their own spec", () => {
    const selfCtx: TrustedDecisionContext = { ...ctx, principal: makeTestPrincipal("builder-agent") };
    const result = runDeploymentGate(validAgentSpecContent, inReviewMetadata, approvedInitialPolicy, selfCtx);
    expect(result).toEqual({
      outcome: "blocked",
      reason: { type: "self_approval_forbidden", principalId: "builder-agent" },
    });
  });

  it.each<LifecycleState>(["draft", "approved", "deployed", "suspended", "revoked", "rejected"])(
    "blocks with state_not_gateable from non-gateable state `%s` (only in_review is gateable)",
    (state) => {
      const result = runDeploymentGate(validAgentSpecContent, metadataInState(state), approvedInitialPolicy, ctx);
      expect(result).toEqual({ outcome: "blocked", reason: { type: "state_not_gateable", state } });
    },
  );

  it("blocks with subject_mismatch when the policy verdict was produced for different content", () => {
    const mismatchedPolicy: PolicyEvaluationResult = {
      ...approvedInitialPolicy,
      subject: { ...subject, contentHash: "hash-other" },
    };
    const result = runDeploymentGate(validAgentSpecContent, inReviewMetadata, mismatchedPolicy, ctx);
    expect(result).toEqual({
      outcome: "blocked",
      reason: { type: "subject_mismatch", specId: "spec-crm-enricher", version: "1.0.0" },
    });
  });

  it("blocks with subject_mismatch when the metadata refers to a different version", () => {
    const mismatchedMetadata = AgentSpecRuntimeMetadataSchema.parse({ ...inReviewMetadata, version: "9.9.9" });
    const result = runDeploymentGate(validAgentSpecContent, mismatchedMetadata, approvedInitialPolicy, ctx);
    expect(result.outcome).toBe("blocked");
    if (result.outcome === "blocked") expect(result.reason.type).toBe("subject_mismatch");
  });

  it("never transitions to `deployed` for any policy outcome (Step 5 is not a deployment executor)", () => {
    for (const policy of [approvedInitialPolicy, rejectedPolicy, evalRequiredPolicy]) {
      const result = runDeploymentGate(validAgentSpecContent, inReviewMetadata, policy, ctx);
      if (result.outcome === "blocked") continue;
      expect(result.metadata.state).not.toBe("deployed");
    }
  });

  it("is pure: does not mutate the input metadata or its state history", () => {
    const snapshot = structuredClone(inReviewMetadata);
    runDeploymentGate(validAgentSpecContent, inReviewMetadata, approvedInitialPolicy, ctx);
    expect(inReviewMetadata).toEqual(snapshot);
    expect(inReviewMetadata.stateHistory).toHaveLength(2);
  });
});

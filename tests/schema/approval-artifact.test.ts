import { describe, expect, it } from "vitest";
import { ApprovalArtifactSchema } from "../../src/schema/approval-artifact.js";
import { edgeAToB } from "../fixtures/specs.js";

describe("ApprovalArtifactSchema", () => {
  it("accepts an agent_spec approval artifact", () => {
    const candidate = {
      type: "agent_spec",
      artifactId: "approval-001",
      requestedBy: "builder-agent",
      decision: "pending",
      specId: "spec-crm-enricher",
      version: "1.0.0",
    };
    expect(ApprovalArtifactSchema.safeParse(candidate).success).toBe(true);
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

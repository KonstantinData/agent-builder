import { describe, expect, it } from "vitest";
import { ApprovalArtifactSchema } from "../../src/schema/approval-artifact.js";
import {
  RuntimeActionSchema,
  RuntimeAuthorizationInputSchema,
  RuntimeBudgetSchema,
} from "../../src/schema/runtime-authorization.js";
import { validAgentSpecContent } from "../fixtures/specs.js";

const executableMetadata = {
  specId: "spec-crm-enricher",
  version: "1.0.0",
  state: "approved",
  stateHistory: [
    { state: "draft", actor: "builder-agent", timestamp: "2026-07-20T10:00:00Z", reason: "initial draft" },
    { state: "approved", actor: "release-manager", timestamp: "2026-07-23T12:00:00Z", reason: "approved" },
  ],
  requestor: "builder-agent",
};

const callContext = {
  rootRunId: "run-root",
  parentRunId: null,
  callChain: ["spec-crm-enricher"],
  remainingDepth: 2,
  remainingCallBudget: 3,
  remainingTokenBudget: 20_000,
  remainingTimeBudget: 30_000,
};

const edgeApproval = ApprovalArtifactSchema.parse({
  type: "call_graph_edge",
  artifactId: "approval-edge-001",
  requestedBy: "builder-agent",
  decision: "approved",
  decidedBy: "release-manager",
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

describe("Runtime authorization schemas", () => {
  it("accepts runtime budgets in runtime spend-down dimensions", () => {
    expect(RuntimeBudgetSchema.safeParse({ callBudget: 1, tokenBudget: 1_000, timeBudget: 5_000 }).success).toBe(true);
  });

  it("rejects spec-budget-shaped runtime budgets", () => {
    expect(RuntimeBudgetSchema.safeParse({ costCeiling: 1, maxIterations: 1, timeoutMs: 5_000 }).success).toBe(false);
  });

  it("accepts tool and agent runtime actions", () => {
    expect(RuntimeActionSchema.safeParse({ type: "tool_call", toolId: "crm.enrich", scope: "tenant:acme:crm" }).success).toBe(true);
    expect(
      RuntimeActionSchema.safeParse({
        type: "agent_call",
        calleeSpecId: "spec-web-search",
        calleeVersionOrChannel: "1.0.0",
        intent: "query",
        childBudget: { callBudget: 1, tokenBudget: 1_000, timeBudget: 5_000 },
      }).success,
    ).toBe(true);
  });

  it("accepts edge approval artifacts as runtime inputs, not raw edge arrays", () => {
    const candidate = {
      spec: validAgentSpecContent,
      metadata: executableMetadata,
      action: { type: "tool_call", toolId: "crm.enrich", scope: "tenant:acme:crm" },
      callContext,
      currentRunId: "run-root",
      edgeApprovals: [edgeApproval],
    };
    expect(RuntimeAuthorizationInputSchema.safeParse(candidate).success).toBe(true);

    const rawEdgeCandidate = {
      ...candidate,
      edgeApprovals: [edgeApproval.type === "call_graph_edge" ? edgeApproval.edge : {}],
    };
    expect(RuntimeAuthorizationInputSchema.safeParse(rawEdgeCandidate).success).toBe(false);
  });
});


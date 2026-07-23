import { describe, expect, it } from "vitest";
import { authorizeRuntimeAction } from "../../src/runtime/authorize-runtime-action.js";
import { ApprovalArtifactSchema, type ApprovalArtifact } from "../../src/schema/approval-artifact.js";
import { AgentSpecContentSchema } from "../../src/schema/agent-spec-content.js";
import { AgentSpecRuntimeMetadataSchema, type AgentSpecRuntimeMetadata } from "../../src/schema/agent-spec-runtime-metadata.js";
import { CallContextSchema, type CallContext } from "../../src/schema/call-context.js";
import { SpecIdSchema } from "../../src/schema/common.js";
import {
  type AgentCallRuntimeAction,
  type RuntimeAuthorizationInput,
} from "../../src/schema/runtime-authorization.js";
import { validAgentSpecContent } from "../fixtures/specs.js";

function metadataInState(state: string): AgentSpecRuntimeMetadata {
  return AgentSpecRuntimeMetadataSchema.parse({
    specId: "spec-crm-enricher",
    version: "1.0.0",
    state,
    stateHistory: [
      { state: "draft", actor: "builder-agent", timestamp: "2026-07-20T10:00:00Z", reason: "initial draft" },
      { state, actor: "release-manager", timestamp: "2026-07-23T12:00:00Z", reason: "test state" },
    ],
    requestor: "builder-agent",
  });
}

const executableMetadata = metadataInState("approved");

function callContext(overrides: Record<string, unknown> = {}): CallContext {
  return CallContextSchema.parse({
    rootRunId: "run-root",
    parentRunId: null,
    callChain: ["spec-crm-enricher"],
    remainingDepth: 2,
    remainingCallBudget: 3,
    remainingTokenBudget: 20_000,
    remainingTimeBudget: 30_000,
    ...overrides,
  });
}

function edgeApproval(overrides: Record<string, unknown> = {}): ApprovalArtifact {
  return ApprovalArtifactSchema.parse({
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
      ...overrides,
    },
  });
}

function baseInput(overrides: Partial<RuntimeAuthorizationInput> = {}): RuntimeAuthorizationInput {
  return {
    spec: validAgentSpecContent,
    metadata: executableMetadata,
    action: { type: "tool_call", toolId: "crm.enrich", scope: "tenant:acme:crm" },
    callContext: callContext(),
    currentRunId: "run-current",
    edgeApprovals: [edgeApproval()],
    ...overrides,
  };
}

const agentAction = {
  type: "agent_call",
  calleeSpecId: SpecIdSchema.parse("spec-web-search"),
  calleeVersionOrChannel: "1.0.0",
  intent: "query",
  childBudget: { callBudget: 1, tokenBudget: 5_000, timeBudget: 10_000 },
} satisfies AgentCallRuntimeAction;

describe("authorizeRuntimeAction", () => {
  it("allows an exact declared tool call without executing it", () => {
    expect(authorizeRuntimeAction(baseInput())).toEqual({ outcome: "allowed", actionType: "tool_call" });
  });

  it.each(["draft", "in_review", "deployed", "suspended", "revoked", "rejected"])(
    "blocks non-v0.1-executable state `%s`",
    (state) => {
      expect(authorizeRuntimeAction(baseInput({ metadata: metadataInState(state) }))).toEqual({
        outcome: "blocked",
        reason: { type: "runtime_state_not_executable", state },
      });
    },
  );

  it("blocks when metadata does not match the acting spec version", () => {
    const metadata = AgentSpecRuntimeMetadataSchema.parse({ ...executableMetadata, version: "9.9.9" });
    expect(authorizeRuntimeAction(baseInput({ metadata }))).toEqual({
      outcome: "blocked",
      reason: { type: "runtime_subject_mismatch", specId: "spec-crm-enricher", version: "1.0.0" },
    });
  });

  it("blocks when the acting spec is not the call-chain tail", () => {
    expect(authorizeRuntimeAction(baseInput({ callContext: callContext({ callChain: ["spec-other"] }) }))).toEqual({
      outcome: "blocked",
      reason: { type: "call_context_invalid", reason: "acting_spec_not_call_chain_tail" },
    });
  });

  it("blocks undeclared tools and non-exact scopes", () => {
    expect(
      authorizeRuntimeAction(
        baseInput({ action: { type: "tool_call", toolId: "email.send", scope: "tenant:acme:crm" } }),
      ),
    ).toEqual({ outcome: "blocked", reason: { type: "tool_not_declared", toolId: "email.send" } });

    expect(
      authorizeRuntimeAction(
        baseInput({ action: { type: "tool_call", toolId: "crm.enrich", scope: "tenant:acme" } }),
      ),
    ).toEqual({
      outcome: "blocked",
      reason: { type: "tool_scope_not_allowed", toolId: "crm.enrich", scope: "tenant:acme" },
    });
  });

  it("allows an approved agent call and returns the authorized next CallContext", () => {
    const result = authorizeRuntimeAction(baseInput({ action: agentAction }));
    expect(result).toEqual({
      outcome: "allowed",
      actionType: "agent_call",
      nextCallContext: {
        rootRunId: "run-root",
        parentRunId: "run-current",
        callChain: ["spec-crm-enricher", "spec-web-search"],
        remainingDepth: 0,
        remainingCallBudget: 1,
        remainingTokenBudget: 5_000,
        remainingTimeBudget: 10_000,
      },
    });
  });

  it("inherits the tightest depth cap into the child context", () => {
    const deeperSpec = AgentSpecContentSchema.parse({
      ...validAgentSpecContent,
      declaredAgentCalls: [
        {
          ...(validAgentSpecContent.declaredAgentCalls[0] as object),
          maxDepth: 4,
        },
      ],
    });
    const result = authorizeRuntimeAction(
      baseInput({
        spec: deeperSpec,
        action: agentAction,
        callContext: callContext({ remainingDepth: 5 }),
        edgeApprovals: [edgeApproval({ maxDepth: 3 })],
      }),
    );

    expect(result).toEqual({
      outcome: "allowed",
      actionType: "agent_call",
      nextCallContext: {
        rootRunId: "run-root",
        parentRunId: "run-current",
        callChain: ["spec-crm-enricher", "spec-web-search"],
        remainingDepth: 2,
        remainingCallBudget: 1,
        remainingTokenBudget: 5_000,
        remainingTimeBudget: 10_000,
      },
    });
  });

  it("blocks agent calls missing from the immutable spec declaration", () => {
    expect(
      authorizeRuntimeAction(
        baseInput({
          action: { ...agentAction, calleeSpecId: SpecIdSchema.parse("spec-billing") },
        }),
      ),
    ).toEqual({
      outcome: "blocked",
      reason: {
        type: "agent_call_not_declared",
        calleeSpecId: "spec-billing",
        calleeVersionOrChannel: "1.0.0",
      },
    });
  });

  it("ignores non-approved edge artifacts and blocks when no approved matching edge exists", () => {
    const pendingEdge = ApprovalArtifactSchema.parse({
      ...edgeApproval(),
      artifactId: "approval-edge-pending",
      decision: "pending",
    });
    expect(authorizeRuntimeAction(baseInput({ action: agentAction, edgeApprovals: [pendingEdge] }))).toEqual({
      outcome: "blocked",
      reason: {
        type: "call_edge_not_approved",
        calleeSpecId: "spec-web-search",
        calleeVersionOrChannel: "1.0.0",
      },
    });
  });

  it("blocks ambiguous approved edge artifacts for the same caller/callee join key", () => {
    expect(
      authorizeRuntimeAction(
        baseInput({
          action: agentAction,
          edgeApprovals: [
            edgeApproval({ maxCallsPerRun: 3 }),
            edgeApproval({ maxCallsPerRun: 2 }),
          ],
        }),
      ),
    ).toEqual({
      outcome: "blocked",
      reason: {
        type: "ambiguous_call_edge_approval",
        calleeSpecId: "spec-web-search",
        calleeVersionOrChannel: "1.0.0",
      },
    });
  });

  it("requires the intent to be allowed by both the spec declaration and the approved edge", () => {
    expect(
      authorizeRuntimeAction(
        baseInput({
          action: agentAction,
          edgeApprovals: [edgeApproval({ allowedIntents: ["delegate"] })],
        }),
      ),
    ).toEqual({ outcome: "blocked", reason: { type: "call_intent_not_allowed", intent: "query" } });
  });

  it("blocks human-gated edges fail-closed in v0.1", () => {
    expect(
      authorizeRuntimeAction(
        baseInput({
          action: agentAction,
          edgeApprovals: [edgeApproval({ requiresHumanGate: true })],
        }),
      ),
    ).toEqual({
      outcome: "blocked",
      reason: {
        type: "human_gate_required",
        calleeSpecId: "spec-web-search",
        calleeVersionOrChannel: "1.0.0",
      },
    });
  });

  it("lets a matching human-gated edge fail closed before ambiguous edge handling", () => {
    expect(
      authorizeRuntimeAction(
        baseInput({
          action: agentAction,
          edgeApprovals: [
            edgeApproval({ requiresHumanGate: false }),
            edgeApproval({ requiresHumanGate: true }),
          ],
        }),
      ),
    ).toEqual({
      outcome: "blocked",
      reason: {
        type: "human_gate_required",
        calleeSpecId: "spec-web-search",
        calleeVersionOrChannel: "1.0.0",
      },
    });
  });

  it("rejects cycles using the full call chain, not only depth", () => {
    expect(
      authorizeRuntimeAction(
        baseInput({
          action: agentAction,
          callContext: callContext({
            callChain: [
              SpecIdSchema.parse("spec-web-search"),
              SpecIdSchema.parse("spec-crm-enricher"),
            ],
          }),
        }),
      ),
    ).toEqual({ outcome: "blocked", reason: { type: "cycle_detected", calleeSpecId: "spec-web-search" } });
  });

  it("blocks exhausted depth and call budget before deriving a child context", () => {
    expect(
      authorizeRuntimeAction(baseInput({ action: agentAction, callContext: callContext({ remainingDepth: 0 }) })),
    ).toEqual({ outcome: "blocked", reason: { type: "depth_exhausted" } });

    expect(
      authorizeRuntimeAction(
        baseInput({
          action: {
            ...agentAction,
            childBudget: { ...agentAction.childBudget, callBudget: 0 },
          },
          callContext: callContext({ remainingCallBudget: 0 }),
        }),
      ),
    ).toEqual({ outcome: "blocked", reason: { type: "call_budget_exhausted" } });
  });

  it("blocks child runtime budgets that exceed caller remaining budget or edge/spec call limits", () => {
    expect(
      authorizeRuntimeAction(
        baseInput({
          action: { ...agentAction, childBudget: { callBudget: 1, tokenBudget: 25_000, timeBudget: 10_000 } },
        }),
      ),
    ).toEqual({
      outcome: "blocked",
      reason: {
        type: "budget_increase_forbidden",
        budget: { callBudget: 1, tokenBudget: 25_000, timeBudget: 10_000 },
      },
    });

    expect(
      authorizeRuntimeAction(
        baseInput({
          action: { ...agentAction, childBudget: { callBudget: 4, tokenBudget: 5_000, timeBudget: 10_000 } },
        }),
      ),
    ).toEqual({
      outcome: "blocked",
      reason: {
        type: "budget_increase_forbidden",
        budget: { callBudget: 4, tokenBudget: 5_000, timeBudget: 10_000 },
      },
    });
  });

  it("fails closed when the runtime authorization boundary input is structurally invalid", () => {
    const invalidInput = {
      ...baseInput(),
      currentRunId: "",
    } as RuntimeAuthorizationInput;

    expect(authorizeRuntimeAction(invalidInput)).toEqual({
      outcome: "blocked",
      reason: { type: "input_invalid", reason: "schema_validation_failed" },
    });
  });
});

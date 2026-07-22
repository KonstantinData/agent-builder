import {
  AgentSpecContentSchema,
  type AgentSpecContent,
} from "../../src/schema/agent-spec-content.js";
import {
  AgentCallPolicyEdgeSchema,
  type AgentCallPolicyEdge,
} from "../../src/schema/agent-call-policy-edge.js";
import {
  BuilderIntentDraftSchema,
  type BuilderIntentDraft,
} from "../../src/schema/builder-intent-draft.js";
import { BudgetSchema, SpecIdSchema, type Budget, type SpecId } from "../../src/schema/common.js";
import { TrustDomainSchema, type TrustDomain } from "../../src/schema/trust-domain.js";

// --- AgentSpecContent: a valid parent spec plus reduced/expanding children ---

export const validAgentSpecContentRaw = {
  specId: "spec-crm-enricher",
  version: "1.0.0",
  parentVersion: null,
  contentHash: "hash-v1",
  name: "CRM Enricher",
  objective: "Enrich lead records with firmographic data",
  promptTemplate: "You are a CRM enrichment agent operating within tenant acme.",
  declaredTools: [{ toolId: "crm.enrich", scope: "tenant:acme:crm", params: {} }],
  declaredAgentCalls: [
    {
      calleeSpecId: "spec-web-search",
      calleeVersionOrChannel: "1.0.0",
      allowedIntents: ["query"],
      maxDepth: 1,
      maxCallsPerRun: 3,
    },
  ],
  resourceLimits: { costCeiling: 5, maxIterations: 10, timeoutMs: 30_000 },
  evalRequirements: { suiteRef: "suite-crm-v1", passThreshold: 0.9 },
  memoryScope: "tenant:acme:crm",
  trustDomainId: "domain-sales",
  // Deliberately two roles, not one: lets tests exercise a pure addition and a
  // pure removal without ever violating declaredRoles' `.min(1)` floor.
  declaredRoles: ["crm-enrichment", "crm-lead-scoring"],
};

export const validAgentSpecContent: AgentSpecContent =
  AgentSpecContentSchema.parse(validAgentSpecContentRaw);

export const reducedChildSpecContent: AgentSpecContent = AgentSpecContentSchema.parse({
  ...validAgentSpecContentRaw,
  version: "1.1.0-reduced",
  parentVersion: "1.0.0",
  contentHash: "hash-v1.1-reduced",
  resourceLimits: { costCeiling: 3, maxIterations: 8, timeoutMs: 20_000 },
});

export const expandingChildSpecContent: AgentSpecContent = AgentSpecContentSchema.parse({
  ...validAgentSpecContentRaw,
  version: "1.1.0-expanded",
  parentVersion: "1.0.0",
  contentHash: "hash-v1.1-expanded",
  // Budget shrinks here on purpose: a single new call-graph edge must still
  // classify the whole delta as expanding (single-dimension rule).
  resourceLimits: { costCeiling: 3, maxIterations: 8, timeoutMs: 20_000 },
  declaredAgentCalls: [
    ...validAgentSpecContentRaw.declaredAgentCalls,
    {
      calleeSpecId: "spec-billing",
      calleeVersionOrChannel: "1.0.0",
      allowedIntents: ["query"],
      maxDepth: 1,
      maxCallsPerRun: 1,
    },
  ],
});

export const higherCostChildSpecContent: AgentSpecContent = AgentSpecContentSchema.parse({
  ...validAgentSpecContentRaw,
  version: "1.1.0-cost",
  parentVersion: "1.0.0",
  contentHash: "hash-v1.1-cost",
  resourceLimits: { costCeiling: 10, maxIterations: 10, timeoutMs: 30_000 },
});

// Same edge (calleeSpecId/version), same maxDepth/maxCallsPerRun, but the
// allowed intents grow — must still classify as expanding.
export const widenedIntentChildSpecContent: AgentSpecContent = AgentSpecContentSchema.parse({
  ...validAgentSpecContentRaw,
  version: "1.1.0-intents",
  parentVersion: "1.0.0",
  contentHash: "hash-v1.1-intents",
  resourceLimits: { costCeiling: 3, maxIterations: 8, timeoutMs: 20_000 },
  declaredAgentCalls: [
    {
      ...validAgentSpecContentRaw.declaredAgentCalls[0],
      allowedIntents: ["query", "execute_tool"],
    },
  ],
});

// Same tool (toolId/scope), but params change — must still classify as
// expanding, since params may carry capability-relevant data.
export const widenedParamsChildSpecContent: AgentSpecContent = AgentSpecContentSchema.parse({
  ...validAgentSpecContentRaw,
  version: "1.1.0-params",
  parentVersion: "1.0.0",
  contentHash: "hash-v1.1-params",
  resourceLimits: { costCeiling: 3, maxIterations: 8, timeoutMs: 20_000 },
  declaredTools: [{ toolId: "crm.enrich", scope: "tenant:acme:crm", params: { operation: "delete" } }],
});

// Same everything else (budget even shrinks), but declaredRoles grows by one
// — must still classify as expanding (Step 3 decision: any change, addition
// or removal, is conservative capability-expanding).
export const rolesExpandedChildSpecContent: AgentSpecContent = AgentSpecContentSchema.parse({
  ...validAgentSpecContentRaw,
  version: "1.1.0-roles-added",
  parentVersion: "1.0.0",
  contentHash: "hash-v1.1-roles-added",
  resourceLimits: { costCeiling: 3, maxIterations: 8, timeoutMs: 20_000 },
  declaredRoles: [...validAgentSpecContentRaw.declaredRoles, "extra-role"],
});

// Pure subset removal (no addition) — must still classify as expanding, since
// classifyDelta cannot prove nobody else depends on the removed role.
export const rolesRemovedChildSpecContent: AgentSpecContent = AgentSpecContentSchema.parse({
  ...validAgentSpecContentRaw,
  version: "1.1.0-roles-removed",
  parentVersion: "1.0.0",
  contentHash: "hash-v1.1-roles-removed",
  resourceLimits: { costCeiling: 3, maxIterations: 8, timeoutMs: 20_000 },
  declaredRoles: ["crm-enrichment"],
});

// --- BuilderIntentDraft: pre-final, never executable ---

export const validBuilderIntentDraftRaw = {
  draftId: "draft-crm-enricher-001",
  specId: "spec-crm-enricher",
  name: "CRM Enricher",
  objective: "Enrich lead records with firmographic data",
  promptTemplate: "You are a CRM enrichment agent operating within tenant acme.",
  declaredTools: [{ toolId: "crm.enrich", scope: "tenant:acme:crm", params: {} }],
  declaredRoles: ["crm-enrichment", "crm-lead-scoring"],
  resourceLimits: { costCeiling: 5, maxIterations: 10, timeoutMs: 30_000 },
  evalRequirements: { suiteRef: "suite-crm-v1", passThreshold: 0.9 },
  memoryScope: "tenant:acme:crm",
  trustDomainId: "domain-sales",
  requestedAgentCalls: [
    {
      calleeRole: "web-search-agent",
      allowedIntents: ["query"],
      maxDepth: 1,
      maxCallsPerRun: 3,
      rationale: "Needs live company data to enrich the lead record.",
    },
  ],
};

export const validBuilderIntentDraft: BuilderIntentDraft = BuilderIntentDraftSchema.parse(
  validBuilderIntentDraftRaw,
);

// A content object whose specId text equals the draft's draftId above, to
// prove the two artifact kinds are never confused just because an identifier
// string happens to match.
export const contentSharingDraftIdRaw = {
  ...validAgentSpecContentRaw,
  specId: "draft-crm-enricher-001",
};

// --- Call-graph edges: linear chain spec-a -> spec-b -> spec-c ---

const edgeCommon = {
  allowedIntents: ["delegate"],
  dataShareScope: "tenant:acme:shared",
  maxDepth: 1,
  maxCallsPerRun: 5,
  maxCallsPerTimeWindow: 100,
  requiresHumanGate: false,
  trustDomainId: "domain-sales",
};

export const edgeAToB: AgentCallPolicyEdge = AgentCallPolicyEdgeSchema.parse({
  ...edgeCommon,
  callerSpecId: "spec-a",
  callerVersion: "1.0.0",
  calleeSpecId: "spec-b",
  calleeVersionOrChannel: "1.0.0",
});

export const edgeBToC: AgentCallPolicyEdge = AgentCallPolicyEdgeSchema.parse({
  ...edgeCommon,
  callerSpecId: "spec-b",
  callerVersion: "1.0.0",
  calleeSpecId: "spec-c",
  calleeVersionOrChannel: "1.0.0",
});

export const linearEdges: readonly AgentCallPolicyEdge[] = [edgeAToB, edgeBToC];

export const specA: SpecId = SpecIdSchema.parse("spec-a");
export const specB: SpecId = SpecIdSchema.parse("spec-b");
export const specC: SpecId = SpecIdSchema.parse("spec-c");
export const specD: SpecId = SpecIdSchema.parse("spec-d");

// Candidate edge spec-c -> spec-a would close a cycle across the existing chain.
export const cyclicCandidateEdge = { callerSpecId: specC, calleeSpecId: specA };
// Candidate edge spec-a -> spec-d stays acyclic (spec-d is unconnected).
export const acyclicCandidateEdge = { callerSpecId: specA, calleeSpecId: specD };

// --- Budgets for monotonicity tests ---

export const wideBudget: Budget = BudgetSchema.parse({
  costCeiling: 10,
  maxIterations: 20,
  timeoutMs: 60_000,
});
export const narrowBudget: Budget = BudgetSchema.parse({
  costCeiling: 2,
  maxIterations: 5,
  timeoutMs: 10_000,
});
// costCeiling alone exceeds wideBudget's remaining ceiling — one violated
// dimension must be enough to fail monotonicity.
export const overBudget: Budget = BudgetSchema.parse({
  costCeiling: 12,
  maxIterations: 5,
  timeoutMs: 10_000,
});

// --- Spec Assembler fixtures: role resolution across a small approved-specs set ---

export const domainSales: TrustDomain = TrustDomainSchema.parse({
  domainId: "domain-sales",
  owner: "sales-platform-team",
  allowedDataClasses: [],
  allowedToolClasses: [],
  allowedAgentRoles: [],
  crossDomainRules: [],
});

export const webSearchAgentV1: AgentSpecContent = AgentSpecContentSchema.parse({
  ...validAgentSpecContentRaw,
  specId: "spec-web-search",
  version: "1",
  parentVersion: null,
  contentHash: "hash-web-search-v1",
  declaredRoles: ["web-search-agent"],
  declaredAgentCalls: [],
});

export const webSearchAgentV2: AgentSpecContent = AgentSpecContentSchema.parse({
  ...validAgentSpecContentRaw,
  specId: "spec-web-search",
  version: "2",
  parentVersion: "1",
  contentHash: "hash-web-search-v2",
  declaredRoles: ["web-search-agent"],
  declaredAgentCalls: [],
});

// A second, unrelated specId that happens to declare the same role — the
// ambiguous case (as opposed to two versions of the *same* specId, which is
// not ambiguous).
export const rivalWebSearchAgent: AgentSpecContent = AgentSpecContentSchema.parse({
  ...validAgentSpecContentRaw,
  specId: "spec-web-search-rival",
  version: "1",
  parentVersion: null,
  contentHash: "hash-web-search-rival-v1",
  declaredRoles: ["web-search-agent"],
  declaredAgentCalls: [],
});

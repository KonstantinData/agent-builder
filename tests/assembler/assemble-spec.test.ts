import { describe, expect, it } from "vitest";
import { assembleSpec } from "../../src/assembler/assemble-spec.js";
import { AgentSpecContentSchema, type AgentSpecContent } from "../../src/schema/agent-spec-content.js";
import type { AssemblyContext } from "../../src/assembler/assembly-types.js";
import {
  domainSales,
  rivalWebSearchAgent,
  validAgentSpecContentRaw,
  validBuilderIntentDraftRaw,
  webSearchAgentV1,
  webSearchAgentV2,
} from "../fixtures/specs.js";

function existingCrmEnricherSpec(version: string, parentVersion: string | null): AgentSpecContent {
  return AgentSpecContentSchema.parse({
    ...validAgentSpecContentRaw,
    specId: "spec-crm-enricher",
    version,
    parentVersion,
    contentHash: `hash-crm-enricher-${version}`,
  });
}

const contextWithDomainOnly: AssemblyContext = { approvedSpecs: [], trustDomains: [domainSales] };

describe("assembleSpec", () => {
  it("assembles a brand-new spec with no requested calls", () => {
    const draft = { ...validBuilderIntentDraftRaw, requestedAgentCalls: [] };
    const result = assembleSpec(draft, contextWithDomainOnly);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.content.version).toBe("1");
      expect(result.content.parentVersion).toBeNull();
      expect(result.content.declaredAgentCalls).toEqual([]);
    }
  });

  it("assembles a spec with exactly one resolved call", () => {
    const context: AssemblyContext = { approvedSpecs: [webSearchAgentV1], trustDomains: [domainSales] };
    const result = assembleSpec(validBuilderIntentDraftRaw, context);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.content.declaredAgentCalls).toHaveLength(1);
      expect(result.content.declaredAgentCalls[0]?.calleeSpecId).toBe("spec-web-search");
      expect(result.content.declaredAgentCalls[0]?.calleeVersionOrChannel).toBe("1");
    }
  });

  it("rejects with unresolved_callee_role when nothing declares the requested role", () => {
    const draft = {
      ...validBuilderIntentDraftRaw,
      requestedAgentCalls: [
        {
          calleeRole: "nonexistent-role",
          allowedIntents: ["query"],
          maxDepth: 1,
          maxCallsPerRun: 1,
          rationale: "test",
        },
      ],
    };
    const result = assembleSpec(draft, contextWithDomainOnly);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reasons).toEqual([{ type: "unresolved_callee_role", calleeRole: "nonexistent-role" }]);
    }
  });

  it("rejects with ambiguous_callee_role when two distinct specIds declare the same role", () => {
    const context: AssemblyContext = {
      approvedSpecs: [webSearchAgentV1, rivalWebSearchAgent],
      trustDomains: [domainSales],
    };
    const result = assembleSpec(validBuilderIntentDraftRaw, context);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reasons).toHaveLength(1);
      const reason = result.reasons[0];
      expect(reason?.type).toBe("ambiguous_callee_role");
      if (reason?.type === "ambiguous_callee_role") {
        expect(new Set(reason.matchingSpecIds)).toEqual(new Set(["spec-web-search", "spec-web-search-rival"]));
      }
    }
  });

  it("does not treat two versions of the same specId as ambiguous, and resolves to the highest version", () => {
    const context: AssemblyContext = {
      approvedSpecs: [webSearchAgentV1, webSearchAgentV2],
      trustDomains: [domainSales],
    };
    const result = assembleSpec(validBuilderIntentDraftRaw, context);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.content.declaredAgentCalls[0]?.calleeVersionOrChannel).toBe("2");
    }
  });

  it("rejects with trust_domain_not_found when the draft's trustDomainId is unknown", () => {
    const context: AssemblyContext = { approvedSpecs: [webSearchAgentV1], trustDomains: [] };
    const draft = { ...validBuilderIntentDraftRaw, requestedAgentCalls: [] };
    const result = assembleSpec(draft, context);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reasons).toEqual([{ type: "trust_domain_not_found", trustDomainId: "domain-sales" }]);
    }
  });

  it("collects every applicable rejection reason in a single pass", () => {
    const draft = {
      ...validBuilderIntentDraftRaw,
      requestedAgentCalls: [
        {
          calleeRole: "nonexistent-role-a",
          allowedIntents: ["query"],
          maxDepth: 1,
          maxCallsPerRun: 1,
          rationale: "test",
        },
        {
          calleeRole: "nonexistent-role-b",
          allowedIntents: ["query"],
          maxDepth: 1,
          maxCallsPerRun: 1,
          rationale: "test",
        },
      ],
    };
    const result = assembleSpec(draft, { approvedSpecs: [], trustDomains: [] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reasons).toHaveLength(3);
    }
  });

  it("never leaks calleeRole or an unresolved target into the assembled content", () => {
    const context: AssemblyContext = { approvedSpecs: [webSearchAgentV1], trustDomains: [domainSales] };
    const result = assembleSpec(validBuilderIntentDraftRaw, context);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(JSON.stringify(result.content)).not.toContain("calleeRole");
      expect(AgentSpecContentSchema.safeParse(result.content).success).toBe(true);
    }
  });

  it("assigns version 1/null for a brand-new specId and bumps version for an existing specId", () => {
    const draft = { ...validBuilderIntentDraftRaw, requestedAgentCalls: [] };

    const brandNewResult = assembleSpec(draft, contextWithDomainOnly);
    expect(brandNewResult.success).toBe(true);
    if (brandNewResult.success) {
      expect(brandNewResult.content.version).toBe("1");
      expect(brandNewResult.content.parentVersion).toBeNull();
    }

    const existingSpecContext: AssemblyContext = {
      approvedSpecs: [existingCrmEnricherSpec("1", null)],
      trustDomains: [domainSales],
    };
    const bumpedResult = assembleSpec(draft, existingSpecContext);
    expect(bumpedResult.success).toBe(true);
    if (bumpedResult.success) {
      expect(bumpedResult.content.version).toBe("2");
      expect(bumpedResult.content.parentVersion).toBe("1");
    }
  });

  it("is deterministic: identical draft and context produce the same contentHash", () => {
    const draft = { ...validBuilderIntentDraftRaw, requestedAgentCalls: [] };
    const first = assembleSpec(draft, contextWithDomainOnly);
    const second = assembleSpec(draft, contextWithDomainOnly);
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    if (first.success && second.success) {
      expect(first.content.contentHash).toBe(second.content.contentHash);
    }
  });

  it("fails fast with a single schema_validation_failed reason when the draft itself does not parse", () => {
    const malformedDraft = { draftId: "only-a-draft-id" };
    const result = assembleSpec(malformedDraft, contextWithDomainOnly);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reasons).toHaveLength(1);
      expect(result.reasons[0]?.type).toBe("schema_validation_failed");
    }
  });
});

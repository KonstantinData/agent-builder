import { describe, expect, it } from "vitest";
import { AgentSpecContentSchema } from "../../src/schema/agent-spec-content.js";
import { validAgentSpecContentRaw } from "../fixtures/specs.js";

describe("AgentSpecContentSchema", () => {
  it("accepts a valid, fully resolved spec", () => {
    const result = AgentSpecContentSchema.safeParse(validAgentSpecContentRaw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.trustDomainId).toBe("domain-sales");
    }
  });

  it("rejects an unresolved calleeRole in declaredAgentCalls (Invariant 1)", () => {
    const candidate = {
      ...validAgentSpecContentRaw,
      declaredAgentCalls: [
        {
          calleeRole: "web-search-agent",
          allowedIntents: ["query"],
          maxDepth: 1,
          maxCallsPerRun: 3,
        },
      ],
    };
    expect(AgentSpecContentSchema.safeParse(candidate).success).toBe(false);
  });

  it("rejects a wildcard tool scope (Invariant 1)", () => {
    const candidate = {
      ...validAgentSpecContentRaw,
      declaredTools: [{ toolId: "crm.enrich", scope: "tenant:*:crm", params: {} }],
    };
    expect(AgentSpecContentSchema.safeParse(candidate).success).toBe(false);
  });

  it("rejects a toolId outside the closed catalog (Invariant 1)", () => {
    const candidate = {
      ...validAgentSpecContentRaw,
      declaredTools: [{ toolId: "shell.exec", scope: "tenant:acme:crm", params: {} }],
    };
    expect(AgentSpecContentSchema.safeParse(candidate).success).toBe(false);
  });

  it("rejects trustDomainId as a list instead of a scalar (Invariant 2)", () => {
    const candidate = { ...validAgentSpecContentRaw, trustDomainId: ["domain-sales", "domain-billing"] };
    expect(AgentSpecContentSchema.safeParse(candidate).success).toBe(false);
  });

  it("rejects a wildcard character inside a string tool param", () => {
    const candidate = {
      ...validAgentSpecContentRaw,
      declaredTools: [{ toolId: "crm.enrich", scope: "tenant:acme:crm", params: { table: "leads_*" } }],
    };
    expect(AgentSpecContentSchema.safeParse(candidate).success).toBe(false);
  });

  it("rejects an empty declaredRoles array", () => {
    const candidate = { ...validAgentSpecContentRaw, declaredRoles: [] };
    expect(AgentSpecContentSchema.safeParse(candidate).success).toBe(false);
  });

  it("rejects a wildcard character inside a declared role", () => {
    const candidate = { ...validAgentSpecContentRaw, declaredRoles: ["crm-*"] };
    expect(AgentSpecContentSchema.safeParse(candidate).success).toBe(false);
  });
});

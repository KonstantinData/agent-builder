import { describe, expect, it } from "vitest";
import {
  StructuredToolScopeSchema,
  ToolScopeSchema,
  compareToolScopes,
  legacyToolScope,
} from "../../src/schema/tool-scope.js";

const scope = {
  modelVersion: "tool-scope/1" as const,
  toolId: "crm.enrich" as const,
  tenantId: "acme",
  selectors: [
    { key: "namespace" as const, value: "crm" },
    { key: "resource" as const, value: "lead" },
  ],
};

describe("Tool Scope Model v0.1", () => {
  it("accepts a closed, canonical structured scope", () => {
    expect(StructuredToolScopeSchema.parse(scope)).toEqual(scope);
  });

  it("rejects selector duplication, non-canonical order, wildcard values, and unknown fields", () => {
    expect(StructuredToolScopeSchema.safeParse({ ...scope, selectors: [...scope.selectors].reverse() }).success).toBe(false);
    expect(StructuredToolScopeSchema.safeParse({ ...scope, selectors: [{ key: "resource", value: "lead" }, { key: "resource", value: "other" }] }).success).toBe(false);
    expect(StructuredToolScopeSchema.safeParse({ ...scope, tenantId: "acme:*" }).success).toBe(false);
    expect(StructuredToolScopeSchema.safeParse({ ...scope, adapterHint: "invented" }).success).toBe(false);
  });

  it("rejects unknown selector and tool catalog entries", () => {
    expect(StructuredToolScopeSchema.safeParse({ ...scope, toolId: "shell.exec" }).success).toBe(false);
    expect(StructuredToolScopeSchema.safeParse({ ...scope, selectors: [{ key: "path", value: "a" }] }).success).toBe(false);
  });

  it("makes equality the only positive comparison for structured scopes", () => {
    const parsed = StructuredToolScopeSchema.parse(scope);
    expect(compareToolScopes(parsed, parsed)).toBe("equal");
    expect(compareToolScopes(parsed, StructuredToolScopeSchema.parse({ ...scope, selectors: [{ key: "namespace", value: "crm" }] }))).toBe("indeterminate");
    expect(compareToolScopes(parsed, StructuredToolScopeSchema.parse({ ...scope, toolId: "email.send" }))).toBe("disjoint");
  });

  it("keeps legacy scopes exact-only and cross-model comparisons indeterminate", () => {
    const grant = legacyToolScope("crm.enrich", "tenant:acme:crm");
    expect(compareToolScopes(grant, legacyToolScope("crm.enrich", "tenant:acme:crm"))).toBe("equal");
    expect(compareToolScopes(grant, legacyToolScope("crm.enrich", "tenant:acme"))).toBe("indeterminate");
    expect(compareToolScopes(grant, StructuredToolScopeSchema.parse(scope))).toBe("indeterminate");
    expect(ToolScopeSchema.safeParse({ modelVersion: "legacy-exact/1", toolId: "crm.enrich", scope: "tenant:*" }).success).toBe(false);
  });
});

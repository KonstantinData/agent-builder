import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  TOOL_SCOPE_COMPARISON_CATALOG,
  TOOL_SCOPE_MODEL_VERSION,
  TOOL_SCOPE_SELECTOR_KEY_CATALOG,
} from "../../src/schema/tool-scope.js";
import { TOOL_CATALOG } from "../../src/schema/common.js";

describe("Tool Scope Model v0.1 machine-readable contract", () => {
  it("pins the implemented closed catalogs and denies containment enablement", async () => {
    const text = await readFile(new URL("../../contracts/tool-scope-model-v0.1.json", import.meta.url), "utf8");
    const contract = JSON.parse(text) as Record<string, unknown>;
    expect(contract.schemaVersion).toBe("tool-scope-model-contract/1");
    expect(contract.modelVersion).toBe(TOOL_SCOPE_MODEL_VERSION);
    expect(contract.toolCatalog).toEqual(TOOL_CATALOG);
    expect(contract.selectorKeyCatalog).toEqual(TOOL_SCOPE_SELECTOR_KEY_CATALOG);
    expect(contract.comparisonResults).toEqual(TOOL_SCOPE_COMPARISON_CATALOG);
    expect(contract.containment).toEqual({
      enabled: false,
      narrowerResultAvailable: false,
      runtimeAuthorizationChange: "none",
      legacyBehavior: "exact_only",
    });
  });
});

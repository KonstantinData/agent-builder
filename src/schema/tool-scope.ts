import { z } from "zod";
import { NoWildcardStringSchema, ToolIdSchema, type ToolId } from "./common.js";

/**
 * Tool Scope Model v0.1 is a structural representation only.  It deliberately
 * does not define a containment algebra for any tool.  The closed selector
 * catalog makes future, tool-specific semantics explicit instead of allowing
 * an adapter or a string-prefix comparison to invent authority at runtime.
 */
export const TOOL_SCOPE_MODEL_VERSION = "tool-scope/1" as const;

export const TOOL_SCOPE_SELECTOR_KEY_CATALOG = [
  "namespace",
  "resource",
  "subject",
] as const;
export const ToolScopeSelectorKeySchema = z.enum(TOOL_SCOPE_SELECTOR_KEY_CATALOG);
export type ToolScopeSelectorKey = z.infer<typeof ToolScopeSelectorKeySchema>;

export const ToolScopeSelectorSchema = z
  .object({
    key: ToolScopeSelectorKeySchema,
    value: NoWildcardStringSchema,
  })
  .strict();
export type ToolScopeSelector = z.infer<typeof ToolScopeSelectorSchema>;

function isCanonicalSelectorOrder(selectors: readonly ToolScopeSelector[]): boolean {
  return selectors.every((selector, index) => {
    const previous = selectors[index - 1];
    return previous === undefined || previous.key < selector.key;
  });
}

export const StructuredToolScopeSchema = z
  .object({
    modelVersion: z.literal(TOOL_SCOPE_MODEL_VERSION),
    toolId: ToolIdSchema,
    tenantId: NoWildcardStringSchema,
    selectors: z.array(ToolScopeSelectorSchema),
  })
  .strict()
  .superRefine((scope, context) => {
    if (!isCanonicalSelectorOrder(scope.selectors)) {
      context.addIssue({
        code: "custom",
        message: "selectors must be unique and sorted by closed selector key",
        path: ["selectors"],
      });
    }
  });
export type StructuredToolScope = z.infer<typeof StructuredToolScopeSchema>;

/**
 * Existing immutable specs use opaque strings.  They remain valid historical
 * evidence and can only be compared for byte-exact equality in v0.1.
 */
export const LegacyToolScopeSchema = z
  .object({
    modelVersion: z.literal("legacy-exact/1"),
    toolId: ToolIdSchema,
    scope: NoWildcardStringSchema,
  })
  .strict();
export type LegacyToolScope = z.infer<typeof LegacyToolScopeSchema>;

export const ToolScopeSchema = z.discriminatedUnion("modelVersion", [
  LegacyToolScopeSchema,
  StructuredToolScopeSchema,
]);
export type ToolScope = z.infer<typeof ToolScopeSchema>;

export const TOOL_SCOPE_COMPARISON_CATALOG = ["equal", "disjoint", "indeterminate"] as const;
export const ToolScopeComparisonSchema = z.enum(TOOL_SCOPE_COMPARISON_CATALOG);
export type ToolScopeComparison = z.infer<typeof ToolScopeComparisonSchema>;

export function legacyToolScope(toolId: ToolId, scope: string): LegacyToolScope {
  return LegacyToolScopeSchema.parse({ modelVersion: "legacy-exact/1", toolId, scope });
}

/**
 * A comparison result is evidence, never an authorization decision.  V0.1
 * emits no `narrower` result: a later accepted, per-tool scope algebra must
 * introduce that result and its runtime enablement together.
 */
export function compareToolScopes(grant: ToolScope, request: ToolScope): ToolScopeComparison {
  if (grant.toolId !== request.toolId) {
    return "disjoint";
  }

  if (grant.modelVersion !== request.modelVersion) {
    return "indeterminate";
  }

  if (grant.modelVersion === "legacy-exact/1" && request.modelVersion === "legacy-exact/1") {
    return grant.scope === request.scope ? "equal" : "indeterminate";
  }

  if (grant.modelVersion === TOOL_SCOPE_MODEL_VERSION && request.modelVersion === TOOL_SCOPE_MODEL_VERSION) {
    return JSON.stringify(grant) === JSON.stringify(request) ? "equal" : "indeterminate";
  }

  return "indeterminate";
}

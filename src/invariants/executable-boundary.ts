import { AgentSpecContentSchema } from "../schema/agent-spec-content.js";
import { BuilderIntentDraftSchema } from "../schema/builder-intent-draft.js";

/**
 * Invariants 1 + 6: a `BuilderIntentDraft` must never validate as executable
 * spec content, and vice versa. Both schemas use `.strict()`, so a role-based
 * request is rejected by `AgentSpecContentSchema` and the resolved-only
 * content fields are rejected by `BuilderIntentDraftSchema`.
 */
export function isExecutableSpec(candidate: unknown): boolean {
  return AgentSpecContentSchema.safeParse(candidate).success;
}

export function isBuilderIntentDraft(candidate: unknown): boolean {
  return BuilderIntentDraftSchema.safeParse(candidate).success;
}

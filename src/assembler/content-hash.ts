import { createHash } from "node:crypto";
import type { AgentSpecContent } from "../schema/agent-spec-content.js";

/**
 * Sorts object keys recursively; array order is preserved as-is since it is
 * meaningful content (e.g. declaredTools, declaredAgentCalls).
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sortedKeys = Object.keys(record).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      result[key] = canonicalize(record[key]);
    }
    return result;
  }
  return value;
}

/**
 * The parameter type statically enforces that nobody passes in an object
 * that already carries a `contentHash`.
 */
export function computeContentHash(content: Omit<AgentSpecContent, "contentHash">): string {
  const serialized = JSON.stringify(canonicalize(content));
  return createHash("sha256").update(serialized).digest("hex");
}

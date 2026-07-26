import type { LifecycleState, StateHistoryEntry } from "../schema/agent-spec-runtime-metadata.js";

/** v0.1 transitions that have concrete Builder-side evidence contracts. */
export const IMPLEMENTED_LIFECYCLE_TRANSITIONS = {
  draft: ["in_review"],
  in_review: ["approved", "rejected"],
  approved: ["deployed"],
  deployed: [],
  suspended: [],
  revoked: [],
  rejected: [],
} as const satisfies Record<LifecycleState, readonly LifecycleState[]>;

export function isImplementedLifecycleTransition(
  from: LifecycleState,
  to: LifecycleState,
): boolean {
  return (IMPLEMENTED_LIFECYCLE_TRANSITIONS[from] as readonly LifecycleState[]).includes(to);
}

/** Returns a new history only for an allowed next state; never mutates input. */
export function appendLifecycleTransition(
  history: readonly StateHistoryEntry[],
  entry: StateHistoryEntry,
): readonly StateHistoryEntry[] | undefined {
  const previous = history.at(-1);
  if (previous === undefined || !isImplementedLifecycleTransition(previous.state, entry.state)) {
    return undefined;
  }
  if (Date.parse(entry.timestamp) <= Date.parse(previous.timestamp)) return undefined;
  return [...history, entry];
}

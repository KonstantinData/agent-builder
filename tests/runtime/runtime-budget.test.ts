import { describe, expect, it } from "vitest";
import {
  isRuntimeBudgetMonotonic,
  remainingRuntimeBudgetFromContext,
} from "../../src/runtime/runtime-budget.js";
import { CallContextSchema } from "../../src/schema/call-context.js";

const callContext = CallContextSchema.parse({
  rootRunId: "run-root",
  parentRunId: null,
  callChain: ["spec-crm-enricher"],
  remainingDepth: 2,
  remainingCallBudget: 3,
  remainingTokenBudget: 20_000,
  remainingTimeBudget: 30_000,
});

describe("runtime budget monotonicity", () => {
  it("derives runtime spend-down dimensions from CallContext", () => {
    expect(remainingRuntimeBudgetFromContext(callContext)).toEqual({
      callBudget: 3,
      tokenBudget: 20_000,
      timeBudget: 30_000,
    });
  });

  it("accepts child budgets that shrink every runtime dimension", () => {
    expect(
      isRuntimeBudgetMonotonic(
        { callBudget: 3, tokenBudget: 20_000, timeBudget: 30_000 },
        { callBudget: 1, tokenBudget: 5_000, timeBudget: 10_000 },
      ),
    ).toBe(true);
  });

  it("rejects a child budget that increases any runtime dimension", () => {
    expect(
      isRuntimeBudgetMonotonic(
        { callBudget: 3, tokenBudget: 20_000, timeBudget: 30_000 },
        { callBudget: 1, tokenBudget: 25_000, timeBudget: 10_000 },
      ),
    ).toBe(false);
  });
});


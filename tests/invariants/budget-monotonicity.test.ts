import { describe, expect, it } from "vitest";
import { isBudgetMonotonic } from "../../src/invariants/budget-monotonicity.js";
import { narrowBudget, overBudget, wideBudget } from "../fixtures/specs.js";

describe("isBudgetMonotonic (Invariant 5)", () => {
  it("accepts a callee budget that is smaller in every dimension", () => {
    expect(isBudgetMonotonic(wideBudget, narrowBudget)).toBe(true);
  });

  it("rejects a callee budget that exceeds the caller's remaining budget in a single dimension", () => {
    expect(isBudgetMonotonic(wideBudget, overBudget)).toBe(false);
  });
});

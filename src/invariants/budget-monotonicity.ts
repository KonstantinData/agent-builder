import type { Budget } from "../schema/common.js";

/**
 * Invariant 5: budgets may only shrink along a call chain. A callee must
 * never receive a budget larger than what the caller has remaining in any
 * single dimension — otherwise a callee could bypass a limit by adding its
 * own full spec budget on top of an inherited chain budget.
 */
export function isBudgetMonotonic(callerRemaining: Budget, calleeBudget: Budget): boolean {
  return (
    calleeBudget.costCeiling <= callerRemaining.costCeiling &&
    calleeBudget.maxIterations <= callerRemaining.maxIterations &&
    calleeBudget.timeoutMs <= callerRemaining.timeoutMs
  );
}

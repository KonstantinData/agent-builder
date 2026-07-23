import type { CallContext } from "../schema/call-context.js";
import type { RuntimeBudget } from "../schema/runtime-authorization.js";

export function remainingRuntimeBudgetFromContext(callContext: CallContext): RuntimeBudget {
  return {
    callBudget: callContext.remainingCallBudget,
    tokenBudget: callContext.remainingTokenBudget,
    timeBudget: callContext.remainingTimeBudget,
  };
}

/**
 * Runtime monotonicity compares only runtime spend-down dimensions. It must not
 * reuse the spec-level budget invariant, whose axes are cost/iterations/timeout.
 */
export function isRuntimeBudgetMonotonic(
  callerRemaining: RuntimeBudget,
  childBudget: RuntimeBudget,
): boolean {
  return (
    childBudget.callBudget <= callerRemaining.callBudget &&
    childBudget.tokenBudget <= callerRemaining.tokenBudget &&
    childBudget.timeBudget <= callerRemaining.timeBudget
  );
}


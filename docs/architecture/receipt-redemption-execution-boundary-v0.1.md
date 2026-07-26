# Receipt Redemption and Execution Boundary v0.1

> Status: **Proposed.** This is a host-injected contract design. It introduces neither
> a dispatcher nor an executor in the Agent Builder.

## Scope and binding

`receipt-redemption-execution-boundary/1` is tenant-scoped and runs only in the trusted
Runtime/Host domain that owns the persisted authorization store. A Step-16 receipt is
host-local evidence, not portable execution authority. Redemption binds the exact
persisted receipt and parent decision, executor identity/configuration digest, complete
execution-intent digest and effect idempotency key. A caller or model cannot select an
executor or replace any binding.

`redemption_id` is a domain-separated SHA-256 digest over that complete binding. The
store enforces unique `(tenant_id, reservation_id)` and `(tenant_id, redemption_id)`.
Exact retry returns the immutable original record; any same-tenant binding mismatch is
a conflict and blocks.

## Durable state machine

```text
reserved -> redeem_pending -> redeemed -> dispatch_pending
dispatch_pending -> dispatch_accepted | dispatch_rejected | effect_indeterminate
dispatch_accepted -> effect_succeeded | effect_failed | effect_indeterminate
```

`redeemed` is an atomic single-use claim, never proof of execution. `effect_indeterminate`
is terminal for automatic behavior: only authenticated executor readback bound to the
same effect/idempotency key may settle it. No blind retry, re-claim, budget reversal or
new side effect is permitted after uncertainty.

## Required atomic checks

One serializable transaction verifies tenant, receipt/parent linkage, current authority,
freshness/lifecycle/channel evidence and `reserved -> redeemed`. Revoked, superseded,
expired, missing, malformed, unavailable or ambiguous evidence blocks before claim. The
host persists `dispatch_pending` before invoking an effect. The executor receives only
digest-bound action/scope plus idempotency key and returns authenticated readback.

## Prerequisites and acceptance evidence

Acceptance requires a real transactional store with recovery, host credential/isolation
contract, tool containment taxonomy, current authority/lifecycle/channel resolvers,
executor idempotency/readback capability, key/provenance decisions, incident runbook,
non-production E2E/recovery tests and independent security review. Builder artifacts,
if accepted later, are strict schemas, deterministic digest tests and documentation only.

# Production Target Topology, Tenancy, and Trust Ownership v0.1

> Status: **Proposed.** This document requires an attended architecture and product
> acceptance. It activates no host, credential, runtime, deployment, or execution path.

## Decision

Adopt separate tenant-isolated Control Plane, Runtime/Data Plane, Host Integration,
Key Custody, Operations, and Governance trust domains. The Agent Builder remains a
versioned spec and contract producer only.

| Component | Owns | Must not own |
| --- | --- | --- |
| Builder | intent, spec drafts, contract validation | credentials, signing, approval, dispatch, execution |
| Control Plane | policy, approval, revocation, trust domains, audit | tool or agent execution |
| Authorization Store | atomic authority/budget/replay transactions and readback | new authority or dispatch |
| Data Plane | redemption, dispatch, execution and effect readback | admission, approval or scope expansion |
| Host Integration | narrowly bound Git/GitHub/CI effects and readback | protection/review/check bypass |
| KMS/HSM | key custody, signing, rotation and revocation | policy decisions |
| Operations | monitoring, backup/restore and incidents | authority decisions |
| Governance | go-live and risk acceptance | technical evidence generation |

## Tenancy and invariants

Every external request, record, receipt, key reference, audit event, and readback is
bound to one non-wildcard tenant identifier before lookup or mutation. A reservation
identifier is never globally sufficient. Specs have one immutable trust domain; a
cross-domain call needs a separately accepted policy.

1. Only the Control Plane decides authority, lifecycle, edge and revocation.
2. Builder, model, runtime, store and adapter never mint authority.
3. Runtime evidence is version-, digest-, scope-, tenant-, time- and revision-bound.
4. Missing, ambiguous, stale, future-dated or malformed evidence blocks.
5. Budget debit and replay protection use one serializable/linearizable store operation.
6. Reservation is not dispatch; dispatch requires separately defined single-use redemption.
7. External effects carry an idempotency key and authoritative readback; unknown state blocks.
8. Private keys remain in KMS/HSM. The Builder and Data Plane have no key custody.
9. Merge requires exact head/base, protection, independent review, checks, manifests and readback.
10. No unattended scheduler may exceed an explicit intent, budget and persisted/read-back state.

## Acceptance evidence

Before accepting this ADR, name accountable owners and escalation paths; publish a
trust-boundary/data-flow diagram; decide tenant isolation for logs, backups and keys;
accept key custody, store recovery/migration, redemption, host adapter and operations
contracts; and require non-production E2E evidence plus independent security review.

## Explicit exclusions

This repository does not implement a database, migration, runtime credential, private
key, KMS/HSM, executor, dispatcher, redemption, deployment, GitHub administration,
branch-protection bypass, or unattended scheduler.

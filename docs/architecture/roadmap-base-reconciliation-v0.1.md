# Roadmap Base Reconciliation Contract v0.1

Status: Claude-locked Task 19 governance contract.

The canonical machine-readable artifact is
`contracts/roadmap-base-reconciliation-v0.1.json`, identified by contract digest
`84e17c0488f98a08b08977f915f9f17a9ad3cc128465f124f8a87c570f03cc38`.
The implementation policy digest is
`a50d8a852a69c35d4313a5246f6689ee8cb4403332c5828e4b54cf5196f39d49`.
The unchanged Task 19 execution scope was locked through the real SHA-pinned native
Claude adapter in round 2 with `locked-step-contract/2` digest
`9dbecc775f5b6b368e08dbb77c023367ac2b92753ba9446ff2cf728b19281614`.
Round 1 rejected contradictory model-routing evidence; the second candidate changed
only that block to the applied `gpt-5.6-sol` / `high` route with a four-turn observable
budget.

## Human review authority decision

On 2026-07-24 the repository owner ended further Claude collaboration for this
delivery. The already completed negotiation remains immutable historical evidence, but
Claude is no longer an implementation-review gate for Task 19. Three bounded review
attempts had produced no response bytes, including a final 300-second attempt, so no
approval or finding was inferred from the unavailable external runtime.

Task 19 implementation acceptance instead requires the complete repository typecheck
and test suite plus independent correctness and security reviews. This attended human
decision does not weaken the runtime reconciliation policy, alter the locked contract
or policy digests, authorize a merge bypass, or remove the existing adapter needed to
replay historical evidence. Any broader adapter replacement is a separate roadmap
decision outside this slice.

## Problem

Step 16 intentionally retains its immutable domain anchor at Step 15 merge
`b3244c73ca79c68dbba3b4a05234f93d3ed92752`. PRs 17 and 18 then added only bounded
orchestration governance, advancing `origin/main` to
`aeec5a84d0dd3ae16bfad39b81cc74291be0002f`. Strict base equality therefore produces
`roadmap_base_reconciliation_unverified` rather than silently rebasing Step 16.

Changing `expectedBaseMergeSha` to the current head would not solve the problem: the
reconciliation PR's own merge would advance `main` again. This contract keeps the
domain anchor immutable and permits a later Step 16 run to bind its locked contract to
the exact observed `origin/main` only through a trusted transparent-meta chain proof.

## Transparent meta-chain proof

A `roadmap-base-reconciliation-proof/1` contains one to four ordered commit records.
The first parent must equal the candidate's domain anchor, every next parent must equal
the previous merge commit, and the final merge commit must equal the exact inspected
`origin/main`. Merge commits, PR numbers, and PR heads must be unique.

Every record must prove all of the following through the injected repository inspector:

- GitHub pull-request provenance and squash merge;
- the merge commit is reachable from the observed `origin/main`;
- the merge tree exactly matches the verified PR head;
- the PR is merged and the exact head completed `verify` successfully;
- the pinned workflow-safety manifest digest matches;
- changed paths are sorted, unique, and limited to the enumerated orchestration,
  contract, architecture, roadmap, test, README, or `.gitignore` surfaces;
- capability effect is `reduce_or_preserve` and deployment effect is `none`.

`.github`, dependency manifests and lockfiles, secrets, runtime/schema/domain source,
deployment, gates, harnesses, and other unknown paths are forbidden. Direct pushes,
merge commits without PR provenance, gaps, forks, duplicates, excessive history,
wrong-head CI, failed CI, tree mismatch, malformed evidence, policy drift, proof-digest
mutation, and head drift all fail closed.

The current bootstrap evidence is PR 17 at merge `ce8c4ba` and PR 18 at merge
`aeec5a8`, both with exact-head `verify` success. After Task 19 is merged, a fresh proof
must also include its real merge and PR-head evidence before Step 16 can be selected.
No future SHA is invented in this contract.

## Durable binding and replay

Repository inspection is persisted once as a digest-bound event containing completed
roadmap reachability, the complete reconciliation proof, and a canonical digest of the
inspection value. Immediately before selection, and again after a resume at this
boundary, a fresh read-only inspection must reproduce that value digest exactly. Any
head or evidence drift stops. Selection itself consumes only the persisted event, so the
confirmation cannot silently replace the proof that replay is bound to.

Pre-contract v1 snapshots and events remain byte-for-byte replayable: the added fields
are optional at the historical schema boundary and exact-base snapshots continue to
omit the new binding. An older run paused after repository inspection has no trustworthy
reconciliation value digest, so continuation records
`roadmap_base_reconciliation_unverified` rather than rehashing history, guessing a
migration, or treating the ledger as corrupt.

The selected step stores a compact `roadmap-base-reconciliation-binding/1` containing
the policy digest, immutable domain base, exact observed `origin/main`, and proof digest.
The Claude negotiation request and the resulting locked step contract must carry the
same binding. Reducer replay rejects a missing or different binding before external
implementation can be treated as authorized.

Exact-base selection remains valid without a reconciliation proof, and a superfluous
proof cannot override or block that exact relation. Reconciled selection
is available only when the canonical roadmap explicitly names policy version
`roadmap-base-reconciliation/1`.

## Branch protection and authority

Branch protection is not a prerequisite for read-only inspection, safe roadmap
selection, contract negotiation, implementation, verification, feature-branch push, or
PR creation. It remains a mandatory, immediately re-evaluated merge condition under the
Host Workflow Adapter Contract. An unprotected `main` still produces
`merge_authority_missing`; this slice adds no admin, check, review, or protection bypass.

## Non-claims

This slice does not implement Step 16, a real repository inspector, real verification or
Git/GitHub runners, credentials, scheduling, branch cleanup, or merge authority. It
validates evidence supplied by a separately trusted inspector and makes absence or
uncertainty observable. The four-commit limit is a deliberate stop boundary: additional
meta work requires a new attended contract rather than automatic scope growth.

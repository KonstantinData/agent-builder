# Host Workflow Adapter Contract v0.1

Status: Claude-locked Slice 18 architecture contract, implemented as a bounded
attended-local composition over the Autonomous Roadmap Orchestration Contract v0.1.

The canonical machine-readable artifacts are:

- `contracts/host-workflow-adapters-v0.1.json`;
- `contracts/workflow-safety-manifest.v1.json`, identified by manifest digest
  `09335ea86b39ee2c6f1b026500ae7e5b4faf6c24f1bbdfc37612d16358abbbe1`.

The standalone adapter contract is identified by digest
`baed38a47cabbdc37e51d4253925ed20c8a38640f4b787c1317bac0b6355372a`.

The final runtime `locked-step-contract/2` form was accepted through the real native
Claude adapter on 2026-07-24 with contract digest
`5267ee92a1e5836a8b8c23fe6dc6af0ae3ce08a211e082c0ff567a54d1bea159`.
The adapter verified executable SHA-256
`9e24fc289828968ce3411fafaee42d4484d3e34b63e873358ede4395aceb1b33`,
disabled tools, sessions, dynamic settings, slash commands, and MCP, and accepted only
the exact candidate digest or an explicit conflict.

The locked base is merge commit
`ce8c4ba614347f408715cdb3fe0dfc1ce128466a` from PR #17.

## Purpose and authority boundary

Slice 18 composes the already-defined phases from `contract_locked` through
`step_complete` without making repository code a Git, GitHub, process, approval, or
deployment authority. The repository ships strict contracts, pure evaluators,
persisted controller composition, a real fail-closed pinned Claude CLI contract
negotiator, and deterministic workflow-adapter test fakes only.

Executable step contracts use `locked-step-contract/2` and bind the workflow manifest
digest plus the required `verify` check. Their controller addendum fixes a maximum of
32 transitions per invocation, the existing exclusive no-wait/no-eviction lock,
automation through `step_complete`, external attended implementation as readback-only,
and `branchDeletionAllowed: false`.

`v0.1RealRunnersIncluded` is `false` for implementation, verification, Git, GitHub,
and merge effects. The Claude contract counterparty is the deliberate exception: its
native CLI adapter requires an exact executable path and SHA-256, disables shell,
tools, sessions, dynamic settings, slash commands, and MCP, requests a JSON-Schema
validated structured result, bounds time and output, and rejects malformed or widened
contracts. There is no
real verification subprocess runner, Git runner, GitHub runner, credential store,
token broker, branch-protection administrator, or background scheduler in this slice.
Production activation requires separately trusted, host-injected workflow adapters. A
missing, partial, malformed, unavailable, or uncertain adapter remains a visible
fail-closed boundary.

The Builder Agent remains a proposer. Claude remains a contract-review peer. Neither
can approve a change, create merge authority, bypass CI, or grant a Control Plane
lifecycle transition.

## Workflow safety manifest

The only recognized repository workflow is `.github/workflows/ci.yml`, pinned by its
exact SHA-256 digest
`cfda3f0ec624b10599c5a5002285e11374cf178275cfa9c9fa4f3538e03d3d31`.
It is classified as `verification_only` and contributes exactly one required check:
`verify`.

Any workflow path, workflow byte digest, classification, required-check set, or
manifest digest mismatch produces unknown workflow state and blocks the merge gate.
The adapter contract does not infer safety from a workflow filename or a successful
check alone.

## Adapter protocol

External attended implementation is readback-only. Repository code may verify an
already produced implementation head, its exact locked base, contract digest, changed
paths, ancestry, and clean-worktree evidence. It cannot invoke Codex or another
implementation process.

Every state-changing adapter is registered as an indivisible `invoke` plus `readback`
pair:

- verification;
- feature-ref creation;
- pull-request creation;
- merge.

CI status and the merge gate are read-only inspections. Every adapter descriptor and
evidence envelope is digest-bound to its producer configuration and the exact workflow
effect binding.

Readback has only three outcomes:

- `settled`: exact trustworthy evidence proves the requested effect;
- `failed`: trustworthy evidence proves a terminal failure;
- `inconclusive`: the provider is pending, unavailable, ambiguous, or untrustworthy.

An inconclusive result never means success. The controller persists the pending event
before invoking a state-changing adapter. After restart, a pending phase performs
readback only with the original idempotency key and binding. It never invokes the
effect a second time merely because the first result is unknown.

## Bounded CI reads

Each step may perform at most three persisted CI reads. A valid observation is bound to
the exact pull request and head SHA and contains exactly the required `verify` check.
Queued or in-progress checks remain pending while budget remains. Failure, cancellation,
timeout, action-required, startup failure, malformed evidence, a wrong head, duplicate
or missing required checks, or exhausted read budget stops fail-closed.

The CI budget is a read budget. It does not renew the run intent, extend its validity
window, add side-effect attempts, or authorize another ref, PR, or merge.

## Feature ref and pull request

The only allowed feature ref is
`refs/heads/orchestration/{runId}/{stepId}`. Force push, deletion, takeover, rebase, and
a second ref are forbidden. Readback must prove the exact locked base and head SHA.
An existing conflicting ref or multiple matching pull requests is a terminal conflict,
not an invitation to overwrite or adopt external work.

The pull request is bound to the exact ref, head, base, title/body digests, and a
machine-readable contract block. Unknown mergeability remains non-authoritative until
later readback proves the merge gate.

## Merge gate

Merge is a separately authorized side effect and is evaluated immediately before merge
invocation. Every one of these conditions must be proven at the same bound head/base:

- the run intent explicitly grants merge;
- the default branch head still equals the locked base;
- the pull request is open, mergeable, and bound to the exact expected head;
- the default branch is protected;
- required reviews and exactly the `verify` check are satisfied;
- the workflow safety manifest matches the pinned workflow bytes;
- the diff remains inside the locked contract and touches no forbidden surface;
- there is no capability expansion, deployment change, admin bypass, or bypass use.

An unprotected default branch produces `merge_authority_missing` before the merge
adapter can be invoked. Unknown branch protection is equally blocking. Admin, force,
check, review, or branch-protection bypass is not implemented and must not be invented
by a host adapter.

Merge readback must prove the exact expected head, merge commit, merged state, and that
the merge commit is reachable from `origin/main`. Anything less is inconclusive or a
terminal failure.

## Cleanup and orphan evidence

Cleanup mode is `verification_only`. Slice 18 does not delete remote refs, close foreign
pull requests, or take over unknown work. After a feature ref has been pushed, every
terminal failure must persist an `OrphanRefReport` containing the run, step, contract,
ref, head, observed PR state, failure reason, instant, and evidence digest.

The report is durable recovery evidence, not deletion authority. An operator may later
resolve the ref through a separately authorized workflow after proving its ownership
and merge or closure state.

## Non-claims

This slice does not prove host credentials, GitHub availability, executable provenance,
real command isolation, stable authentication, repository branch protection, CI
success, review success, merge success, or orphan cleanup. Deterministic fakes prove
controller composition and fail-closed behavior only; they must never be described as
real repository operations.

# Autonomous Roadmap Orchestration Contract v0.1

Status: locked architecture contract for the attended-local meta-slice.

The canonical machine-readable bootstrap contract is
`contracts/autonomous-roadmap-orchestration-v0.1.json`, identified by digest
`4cd16d22058ed1bf6579171cfae192c240b92c5450a6901cb18a2dada7aa6bd9`.

## Purpose

This contract adds a finite, persisted protocol for continuing Agent Builder security
hardening work. It does not create an unbounded autonomous agent and does not alter the
Control Plane/Data Plane authority boundary:

> The Builder Agent proposes specs. The Control Plane grants capabilities, edges, and
> lifecycle states. The Data Plane executes only approved, versioned bindings.

The orchestrator may select exactly one uniquely eligible hardening item, negotiate a
versioned contract through a bounded Claude adapter, collect implementation and
verification evidence, and gate feature-branch, pull-request, CI, and merge operations.
Claude is a discussion and contract-review peer, never an approval or deployment
authority.

## Bootstrap and runtime boundary

The meta-slice itself is bootstrapped by the attended user/Codex workflow. It cannot
authorize or merge itself. Every subsequent run requires a host-verified `RunIntentV1`
bound to an exact `origin/main` revision, validity interval, allowed change classes,
explicit Git/PR/merge permissions, and finite budgets:

- one to three steps per run;
- one to four Claude rounds per step;
- one to two attempts per side-effect phase.

The reducer cannot mint, renew, widen, or replace an intent. Exhaustion is terminal.
v0.1 trusts an injected intent verifier and makes no cryptographic operator-identity
claim.

Execution is attended-local only. Running the orchestration driver in CI is forbidden.
An `external_attended` implementation driver, including the current Codex app task, is
not invokable by repository code. A future `local_process` driver must bind an absolute
executable path and digest, fixed invocation, working directory, allowed environment,
timeout/output limits, and a dry-run attestation. Missing or mismatched driver evidence
stops fail-closed.

## State and persistence

The closed phase sequence is:

```text
intent_verified -> repository_inspected -> step_selected -> contract_negotiating
-> contract_locked -> implementation_pending -> implementation_complete
-> verification_pending -> verified -> branch_push_pending -> branch_pushed
-> pr_create_pending -> pr_open -> ci_pending -> ci_passed -> merge_ready
-> merge_pending -> merged -> cleanup_pending -> step_complete
```

`completed` and `stopped` are terminal. A bounded run may return from `step_complete` to
`repository_inspected` only while the same intent remains valid and has remaining step
budget.

Every external action persists a pending event before invocation. Restart reconciles
the idempotency key and external read-back; it never blindly repeats an uncertain
side effect. Events use monotone sequences, domain-separated SHA-256 digests, explicit
RFC-3339 instants, and canonical JSON. The append-only event is flushed before the
snapshot is atomically replaced. Exact replay is a no-op; identity, sequence, digest,
or snapshot/history conflict is corruption and stops.

Live state belongs under the ignored `.agent-builder/autonomy/` directory or another
explicit host path. Versioned schemas, roadmap facts, and this contract remain in Git.

## Roadmap eligibility

The canonical roadmap is `roadmap/agent-builder-roadmap.v1.json`. Steps 1 through 15
are facts backed only by their real merge commit SHAs and injected ancestry proof; no
historical orchestration events are invented. Step 16 is the single current candidate.

Automatic selection requires exactly one incomplete item whose dependencies are
verified ancestors of the current `origin/main`, whose expected base exactly matches,
whose change class is allowed by the run intent, and whose effects are explicitly
`reduce_or_preserve` and `none` for capability and deployment. Unknown effects,
human-decision flags, zero candidates while work remains, or multiple candidates stop.

Declared and actual paths must stay within the locked scope. `.github`, dependency
manifests and lockfiles, secrets and key files, deployment/release configuration,
repository governance, `.gitignore`, and `src/orchestration/` are forbidden to a later
auto-selected domain item. The attended bootstrap meta-PR is the only reason those
orchestration and ignore files are changed here.

## Model routing policy v1

Model routing is contract evidence, not authority.

- Default at a new task or step boundary: `gpt-5.6-terra`, reasoning `medium`.
- `gpt-5.6-sol` is allowed only for an audited `security_contract`,
  `major_architecture_decision`, `claude_contract_conflict`, at least two recorded
  failed attempts in the same phase, or context complexity at/above the configured
  threshold (100,000 observable input-token-equivalent units in v1).
- Each decision persists the policy version, selected model and effort, triggers,
  justification, observable budget, attempt limit, and fallback decision.
- A runtime that cannot switch the current task records
  `deferred_to_next_task_start`; it does not claim a switch.
- An unavailable selected route stops `model_route_unavailable`. Sol may fall back to
  Terra/medium only when the external run intent explicitly permits degraded routing
  (or when the escalation trigger is no longer present at a later boundary), and the
  fallback is recorded.

Routing never widens a capability, bypasses a Control Plane or deployment gate, extends
a run budget, or clears a human stop.

## Merge gate

The current repository has no deployment workflow on `main`; its only workflow is the
read-only `verify` job. A merge is therefore a separately authorized repository side
effect, not an AgentSpec lifecycle grant. It is allowed only when the run intent grants
it and injected read-back proves the exact PR head, protected default branch, unchanged
compatible base, required CI and review success, contract-bound diff, and absence of a
deploy-on-main or `.github` change. Direct default-branch push, force/admin/check bypass,
unknown branch protection, or unreachable merge read-back stops.

If repository workflows later make merge a deployment action, the same operation is no
longer auto-eligible and requires a human decision plus the existing security gates.

## Proven properties and non-claims

The slice proves deterministic selection and transitions for validated inputs,
bounded negotiation and attempts, explicit model-route evidence, fail-closed adapter
absence, contract-scoped diffs, and tamper-evident local replay.

It does not prove unattended scheduling, recursive Codex execution, stable Claude
authentication, cryptographic operator identity, driver provenance beyond injected
hash evidence, production deployment safety, or the correctness of Step 16. It does
not implement parent-budget consumption, sibling replay protection, tool-call
reservation, receipt redemption, process liveness, channel resolution, key custody, or
real execution.

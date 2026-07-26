# Agent Builder Execution Continuity

## Backlog Completion Boundary

For any request to execute, deliver, or close Agent Builder backlog work, a status
update is never a completion boundary. Work remains active until every item in both
Agent Builder backlogs is either:

- `Done` with verifiable implementation, test, documentation, PR, and merge evidence;
  or
- `Blocked` with a concrete cause, accountable owner, dependency, unblock condition,
  and next review trigger.

An open PR, pending CI, required review, unavailable host dependency, or one blocked
work package blocks only that package. It must not stop discovery or delivery of other
independent, architecture-conformant work packages.

## Response Channel Is Not a Completion Mechanism

While the overall backlog request remains active, agents must not send a terminal
`final` response. This applies even if the text says that it is only a status update
or that the work is continuing. Use ongoing status communication instead and keep the
execution turn active.

When all currently executable packages are waiting for external evidence, record each
exact blocker, establish the permitted follow-up or monitoring path, and re-enter work
when it changes. A final response is allowed only after the backlog completion boundary
above has been live-verified.

## Required Behaviour While Waiting

When a package is waiting for an external event, the agent must:

1. Record the exact live blocker in its Notion item.
2. Continue the next independent, non-blocked package immediately.
3. Keep the waiting package observable and re-enter its merge or delivery sequence as
   soon as the required evidence becomes available.
4. Never claim that the overall request is complete merely because the current wave,
   branch, or PR has reached a wait state.

Before any final completion statement, re-check both backlogs, all active PRs, required
checks, review decisions, local branch status, and remaining local/remote branches.

## Mandatory Autonomous Delivery Loop

For every executable Agent Builder backlog package, agents must autonomously complete
this loop without waiting for a further user prompt:

1. implement the package on its own `codex/` branch, with the required tests and
   documentation;
2. run the relevant validation, commit with a Conventional Commit, push, and create a
   pull request;
3. repeatedly verify exact head/base binding, independent review, required checks, and
   branch protection; merge only when all are actually satisfied;
4. fast-forward local `main` from `origin/main`, verify the merged patch is present,
   and delete only the corresponding verified merged branch;
5. update the linked Notion record with implementation, verification, merge, cleanup,
   and any remaining follow-up evidence;
6. immediately select and start the next independent executable package.

Neither a user-facing update, a successful local test run, a commit, a pushed branch,
an open PR, nor a waiting review/CI check ends this loop or the overall backlog request.

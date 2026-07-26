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

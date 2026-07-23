# Agent Builder Control Plane Architecture

Status: Draft v0.1 — derived from a structured multi-party design discussion (Claude, Codex, Gemini).

## 1. Problem Statement

The `agent-builder` project is a Builder Agent whose job is to design, configure, and
provision other agents. The agents it produces must be reachable 24/7 and able to reach
each other 24/7 — this is not a single-agent tool-use problem, it is a system that can
recursively grant capabilities and create a mesh of long-running, mutually addressable
agents.

Left unconstrained, a system like this is not an agent builder — it is a recursive
privilege-escalation machine. This document exists to prevent that outcome while still
letting the Builder Agent operate autonomously within a bounded lane.

Core rule:

> The Builder Agent proposes specs. The Control Plane grants capabilities, edges, and
> lifecycle states. The Data Plane executes only approved, versioned bindings, and
> enforces budget, chain length, tool rights, memory scope, and cycle-freedom at
> runtime.

## 2. Control Plane vs Data Plane

Split governance from execution, the way infrastructure systems generally do:

- **Control Plane** — decides, validates, approves, revokes, records. Never executes
  agent logic against real tools or real data.
- **Data Plane** — executes only what the Control Plane has approved. Never makes
  admission decisions.

```
Control Plane
  - Immutable Agent Spec Content
  - Mutable Lifecycle Metadata
  - Policy Harness
  - Evaluation Harness
  - Deployment Gate
  - Audit / Trace / Revocation
  - Trust Domain Registry
  - Agent Call-Graph Policy
  - Drift Detection

Data Plane
  - Runtime Harness
  - Tool Execution
  - Agent-to-Agent Execution
  - Scoped Memory Access
  - Runtime Budget Enforcement
  - Call-Context Enforcement
```

"Harness" is not the top-level term — it survives as the name of specific components
(Policy Harness, Evaluation Harness, Runtime Harness) that live inside one of the two
planes, not as the name of the whole architecture.

## 3. Immutable Spec Content vs Mutable Runtime Metadata

The Agent Spec Store is two logically separated stores, not one record that gets
overwritten in place:

```
AgentSpecContent            # immutable, versioned, hashable
  spec_id
  version
  parent_version
  content_hash
  name
  objective
  prompt_template
  declared_tools[]           # {tool_id, scope, params}
  declared_agent_calls[]     # resolved only: {callee_spec_id, callee_version_or_channel, allowed_intents, max_depth, max_calls_per_run}
  resource_limits            # {timeout, max_iterations, cost_ceiling}
  eval_requirements          # {suite_ref, pass_threshold}
  memory_scope
  trust_domain_id            # single immutable domain assignment per spec version

AgentSpecRuntimeMetadata     # mutable, operational
  spec_id
  version
  state
  state_history[]            # {state, actor, timestamp, reason}
  requestor
  deployment_binding?        # {runtime_instance_id, deployed_at, ttl, last_heartbeat}
  ttl
  last_heartbeat?
  suspended_reason?
  revoked_reason?
  superseded_by?
```

Rationale: what was approved must stay verifiable and hashable forever. What is
currently happening with it is operational state that changes constantly (heartbeats,
suspensions). Merging the two recreates the "two truths" problem already rejected for
the earlier Spec-Registry/Agent-Registry split — there is one content record and one
metadata record per version, never two competing sources of truth.

Role-based or otherwise unresolved target requests do not belong in
`AgentSpecContent`. They may exist only before finalization in a separate builder draft
artifact:

```
BuilderIntentDraft
  requested_agent_calls[]     # {callee_role, allowed_intents, rationale}
```

The Deployment Gate must resolve every requested role into concrete
`callee_spec_id`/`callee_version_or_channel` bindings before hashing and approval.
No role expression is executable in the Data Plane, and no unresolved target may appear
in immutable spec content.

## 4. Lifecycle State Machine

```
draft -> in_review -> approved -> deployed -> suspended -> revoked
                    -> rejected  (terminal, superseded_by -> next version)
```

Schema validation, policy lint, and evaluation are **not** separate top-level states —
they are audit/check records inside `in_review`. Modeling every check as its own state
causes combinatorial explosion of the state machine.

Suspension recovery is bifurcated by cause, so the drift/revocation loop (Section 11)
cannot be silently bypassed by a manual resume:

```
cost_limit / rate_limit / transient_runtime_issue:
  suspended -> deployed          (lightweight approval)

drift / anomaly / policy_violation / unsafe_call_graph:
  suspended -> in_review -> approved -> deployed   (full re-review, no shortcut)
```

## 5. Policy Harness

Static, agent-agnostic layer sitting above both Spec and Runtime. Responsibilities:

- Reject specs that request disallowed tool/agent-call combinations.
- Enforce closed catalogs for tools and call intents — no wildcards (e.g. no `crm_*`
  style patterns, no unresolved role-based grants).
- Compare each new spec version against its parent version and classify capability
  deltas before approval.
- Force capability-expanding deltas through the Evaluation Harness and Deployment
  Gate. This includes broader tool scopes, new call-graph edges, higher budgets,
  broader memory or data scopes, and new cross-domain reachability.
- Allow only capability-reducing deltas to use a lightweight path, such as lower
  budgets, narrower scopes, or removed call-graph edges.
- Enforce Trust Domain rules (Section 9).
- Stop a running agent and demand re-approval when Drift Detection (Section 11)
  signals a violation.

## 6. Evaluation Harness

A disposable runtime instantiation between spec candidacy and production approval.
Uses mocks/test doubles only — **never** production credentials, **never** production
memory. Scores a spec version against its declared `eval_requirements` before the spec
can proceed to the Deployment Gate.

## 7. Deployment Gate

One approval mechanism, multiple artifact types — not one gate per artifact type:

```
ApprovalArtifact
  type: agent_spec | call_graph_edge | trust_domain_rule | tool_capability
```

This keeps audit, review, and human-gate logic unified regardless of what is being
approved, instead of building parallel approval systems for specs and for call-graph
edges.

## 8. Agent-to-Agent Call Graph

Default-deny directed graph, not a free mesh:

- No agent-to-agent calls unless an edge is explicitly approved.
- No wildcards, no role-based grants without resolved target IDs.
- `allowed_intents` is drawn from a closed catalog, never free text.
- Every new edge is checked against the **entire current graph** at approval time —
  reachability analysis, cycle detection, cross-trust-domain detection — not validated
  in isolation.

```
AgentCallPolicyEdge
  caller_spec_id
  caller_version
  callee_spec_id
  callee_version_or_channel
  allowed_intents[]
  data_share_scope
  max_depth
  max_calls_per_run
  max_calls_per_time_window
  requires_human_gate
  trust_domain
```

## 9. Trust Domains

`trust_domain` is not a free string on an edge — it is its own Control Plane artifact:

```
TrustDomain
  domain_id
  owner
  allowed_data_classes
  allowed_tool_classes
  allowed_agent_roles
  cross_domain_rules
```

Every agent belongs to an explicit Trust Domain. Cross-domain agent-to-agent calls
require Policy Harness approval as a distinct decision, not an implicit side effect of
approving an edge. A spec has exactly one immutable `trust_domain_id`; agents that need
to touch multiple domains must do so through approved cross-domain rules and call
edges, not through multiple domain memberships.

## 10. Runtime Call Context

Enforced by the Data Plane on every agent-to-agent call:

```
CallContext
  root_run_id
  parent_run_id
  call_chain[]
  remaining_depth
  remaining_call_budget
  remaining_token_budget
  remaining_time_budget
```

Two runtime invariants that per-edge fields alone cannot guarantee:

- **Cycle rejection**: reject a call if `callee_id` already appears in `call_chain`,
  regardless of any individual edge's `max_depth`. Per-edge depth limits do not stop a
  cycle that spans several different edges (A→B→C→A).
- **Budget monotonicity**: `callee_budget <= caller_remaining_budget`, always. A callee
  never adds its own full spec budget on top of an inherited chain budget — child calls
  only spend down from what remains; they cannot top up. Root runs start with an
  approved budget; every hop only consumes it.

### Runtime Harness v0.1 Boundary

Runtime Harness v0.1 is a Data Plane authorization slice, not an execution runtime.
It consumes an already-approved spec version, matching runtime metadata, approved
call-graph edge approval artifacts, a call context, and a planned runtime action. It
returns `allowed` or `blocked` and, for allowed agent-to-agent calls, the derived next
call context.

The v0.1 executable lifecycle state is deliberately limited to `approved` because the
Deployment Gate currently stops there and no deployment executor exists yet. Once a
deployment executor or runtime binding store exists, this boundary should move to
`deployed`.

Runtime Harness v0.1 enforces:

- tool calls by exact declared `tool_id` and exact scope string only; there is no scope
  containment inference until a structured scope model exists
- agent calls by resolved spec declarations and approved `call_graph_edge` artifacts,
  never by raw caller-supplied edges
- intent authorization as the intersection of the immutable spec declaration and the
  approved edge
- human-gated edges fail-closed
- call-context validity, including the acting spec as the tail of `call_chain`
- cycle rejection using the full call chain
- depth, call-budget, token-budget, and time-budget spend-down without runtime budget
  increases

Known v0.1 boundaries:

- `AgentSpecRuntimeMetadata` intentionally carries no `content_hash`, so runtime can
  bind spec content to metadata only by `spec_id` and `version`. The Deployment Gate
  remains the content-hash-bound approval point.
- Callee liveness is not checked without callee metadata or a runtime store. The
  harness authorizes the edge and derived context, not whether the callee is currently
  suspended, revoked, or live.

## 11. Drift Detection and Revocation Loop

```
Runtime Trace -> Drift Detection -> Policy Harness -> Re-Evaluation / Suspension / Revocation
```

Without this loop, Audit/Trace is documentation, not control. It exists because two
failure classes only become visible in production, never at a one-time pre-deploy
evaluation:

- **Semantic drift** — the agent runs correctly but does the substantively wrong thing
  as its environment or the agents it talks to change over time.
- **Privilege creep / monoculture** — a subtly wrong default or a series of individually
  reasonable re-specs accumulate into scope no single gate would have approved at once,
  and — because many agents share the same Builder — the same flaw propagates across
  all of them.

## 12. Rejected Architectures

Explicitly out of scope, even where they would look more productive short-term:

- Builder Agent writes directly executable code into a runtime.
- Builder Agent holds registry or deploy write-access.
- "Simple" agents are allowed to skip Evaluation or the Deployment Gate.
- Child agents receive shared, broadly-scoped credentials instead of narrowly-scoped
  per-agent credentials.
- Tool access granted by wildcard pattern (e.g. `crm_*`).
- Memory is global or shared across agents without explicit, scoped access.
- Evaluations run against live production systems instead of mocks/test doubles.

## 13. Core Invariants

- No direct deploys by the Builder Agent — only versioned, declarative specs.
- No directly executable specs — executability is granted only by the Control Plane.
- No wildcard tool or agent-call grants.
- No role expressions or unresolved agent targets in `AgentSpecContent`; final specs
  contain resolved callee IDs only.
- No shared/global credentials across agents.
- No agent-to-agent calls without an explicitly approved edge.
- No capability-expanding spec delta without Evaluation Harness and Deployment Gate.
- No cycles in the call graph, enforced at runtime via `call_chain`, not only at
  approval time.
- No budget increase along a call chain — budgets only shrink.
- No return from a drift/anomaly-triggered suspension without going back through full
  review.

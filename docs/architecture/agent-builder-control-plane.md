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
  ttl                         # non-authoritative for deployment-binding validity
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

### Runtime Binding / Deployment Executor Boundary v0.1

Runtime Binding v0.1 is the narrow bridge from `approved` to `deployed`. It consumes
an approved `agent_spec` approval artifact, the exact approved `AgentSpecContent`,
matching runtime metadata, and a control-plane-asserted binding context. It produces
an immutable `RuntimeBindingArtifact` plus mutable runtime metadata transitioned to
`deployed`.

It enforces:

- metadata must already be `approved`; the binding executor never creates approval
- spec and metadata must match by `spec_id` and `version`
- approval artifact must be `type: agent_spec`, `decision: approved`, and carry
  `decided_by`/`decided_at`
- approval subject must match spec `spec_id`, `version`, and `content_hash`
- metadata must not already have a deployment binding
- binding context must supply `binding_id`, `runtime_instance_id`, `deployed_at`,
  `ttl`, and an explicit `actor` for state history
- `deployed_at` must be an RFC 3339 instant carrying `Z` or an explicit numeric
  offset, with at most millisecond precision
- `ttl` must be a positive whole-second duration no greater than `315_360_000`
  seconds; this ten-year value is an absolute structural ceiling, not a default
  or recommended lease duration

Runtime Binding v0.1 does not start infrastructure, write a registry, execute tools,
touch memory, create credentials, perform health checks, or attest runtime identity.
It records a content-bound runtime binding only. Existing deployment bindings block
fail-closed; idempotent redeploy/rebind belongs to a later drift/revocation-aware
slice. Runtime authorization evaluates the transported deployment-binding lease as
described below, but heartbeat, process-liveness, and runtime-identity attestation
remain outside this boundary.

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
It consumes an already-approved spec version, a signed full runtime-binding artifact,
required signed lifecycle evidence for the acting spec, optional signed lifecycle
evidence for an agent-call target, approved call-graph edge approval artifacts, a call
context, and a planned runtime action. Its trusted context supplies the authorization
instant and Ed25519 public-key set. It returns `allowed` or `blocked` and, for allowed
agent-to-agent calls, the derived next call context.

Mutable `AgentSpecRuntimeMetadata` is deliberately not a runtime authorization input.
The signed `RuntimeBindingArtifact` supplies immutable deployment identity, content
binding, and lease fields; signed acting lifecycle evidence supplies mutable execution
eligibility. This structurally prevents caller-shaped runtime metadata from acting as
an authority source.

Runtime Harness v0.1 enforces:

- full runtime authorization input validation at the boundary
- Ed25519 origin and integrity verification for the complete runtime binding artifact
- recomputation of immutable spec content and three-way content-hash consistency
- executable signed acting lifecycle state `deployed`, never bare `approved`
- temporal validity of the signed acting runtime binding against a required trusted
  authorization instant, with no default or system-clock fallback
- tool calls by exact declared `tool_id` and exact scope string only; there is no scope
  containment inference until a structured scope model exists
- agent calls by resolved spec declarations and approved `call_graph_edge` artifacts,
  never by raw caller-supplied edges
- intent authorization as the intersection of the immutable spec declaration and the
  approved edge
- ambiguous matching edge approvals fail-closed, so array order never decides
  runtime authorization
- human-gated edges fail-closed
- call-context validity, including the acting spec as the tail of `call_chain`
- cycle rejection using the full call chain
- exact-subject signed lifecycle evidence for agent-call targets, with only `deployed`
  currently callable and at most 300 seconds of freshness
- depth, call-budget, token-budget, and time-budget spend-down without runtime budget
  increases

### Runtime Binding Validity / Lease Expiry v0.1

Runtime Binding Validity v0.1 proves the temporal consistency of the acting spec's
signed full `RuntimeBindingArtifact` before any tool or agent action is authorized.
The Data Plane receives a mandatory `TrustedRuntimeAuthorizationContext` containing
`authorization_time` and a non-empty trusted public-key set; the harness never falls
back to `Date.now()`, another implicit clock, or a caller-supplied verification key.

The signed artifact `ttl` is the only authoritative binding lease for this decision;
runtime metadata is not present in the authorization input. Both `deployed_at` and
`authorization_time` must be RFC 3339 instants with `Z` or an explicit numeric offset
and at most millisecond precision. Comparisons use parsed absolute instants, never
timestamp-string ordering.

```text
expires_at_ms = deployed_at_instant_ms + runtime_binding_artifact.ttl * 1000

valid when:
  deployed_at_instant_ms <= authorization_time_instant_ms < expires_at_ms
```

The lower boundary is inclusive. Authorization before `deployed_at` blocks with
`runtime_binding_not_yet_valid`; authorization exactly at or after `expires_at` blocks
with `runtime_binding_expired`. Expiry blocks authorization only: this pure harness
does not mutate metadata or create a lifecycle transition.

Guard priority is deterministic:

```text
authorization input schema
  -> trusted authorization context and keyset schema
  -> runtime binding evidence present
  -> binding attestation key known
  -> binding signature valid
  -> artifact/spec subject match
  -> recomputed spec-content hash match
  -> temporal binding validity
  -> acting lifecycle attestation key known
  -> acting lifecycle signature valid
  -> acting lifecycle subject match
  -> acting state executable
  -> acting lifecycle freshness
  -> call context
  -> planned action
```

Consequently, a binding signature failure wins over artifact subject, hash, or lease
failures; a content-hash mismatch wins over expiry; expiry wins over acting lifecycle;
and a non-executable signed acting state wins over acting-evidence freshness.

### Runtime Callee Lifecycle Validity v0.1

Agent calls carry an optional top-level evidence object at the runtime authorization
boundary:

```text
AttestedAgentLifecycleEvidence
  payload
    spec_id
    version_or_channel
    state
    asserted_at
    freshness_ttl
  attestation
    key_id
    signature_base64
```

The field is structurally optional because tool calls do not need it, but it is
semantically mandatory for every `agent_call`. Its payload is signed Control Plane
evidence, not a projection of canonical runtime metadata and not a second canonical
lifecycle record. A present evidence object is always schema-validated. Tool calls
ignore structurally valid evidence, including an unknown key, invalid signature,
foreign subject, non-callable state, or invalid freshness; structurally malformed
evidence still makes the complete authorization input invalid.

The lifecycle subject must match the planned action exactly on both
`callee_spec_id` and the opaque `callee_version_or_channel` string. No channel
resolution occurs. Evidence for `stable`, for example, asserts only a state for that
opaque key; it does not prove which concrete version the channel resolves to or that
the resolved target is currently callable.

```text
CALLEE_CALLABLE_STATES = [deployed]
```

Callee callability is intentionally modeled separately from caller executability.
The two state sets are currently identical, but represent different policy concepts
and may evolve independently.

Agent-call guard priority is deterministic after the global Runtime Harness guards:

```text
declared call
  -> approved edge selection
  -> human gate
  -> ambiguous edge
  -> intent intersection
  -> cycle detection
  -> callee lifecycle evidence present
  -> callee attestation key known
  -> callee signature valid
  -> callee lifecycle subject match
  -> callee state callable
  -> callee lifecycle freshness
  -> depth
  -> call budget
  -> child-budget monotonicity
```

The semantic failures include `callee_lifecycle_evidence_missing`, generic attestation
failures, `lifecycle_evidence_subject_mismatch` with role `callee`,
`callee_state_not_callable`, and `lifecycle_evidence_not_fresh` with role `callee`.
This ordering means a cycle wins over a forged callee attestation, while a non-callable
signed state wins over freshness, exhausted depth, or budget. The global ordering
remains authoritative: an expired caller binding blocks before any callee lifecycle
evaluation.

The current harness authenticates the presented lifecycle assertion and bounds its
age, but still performs no callee binding content-hash or lease validation, channel
resolution, registry/store lookup, heartbeat check, process-liveness check, execution,
metadata mutation, or lifecycle transition.

An immutable `RuntimeBindingArtifact` attests deployment evidence at a point in time;
it cannot by itself attest mutable lifecycle state. Acting and callee lifecycle
evidence therefore carry their own assertion time and recency bound, evaluated against
the same injected `authorization_time`. This freshness lease is separate from the
Step 8 binding lease. It narrows but cannot eliminate the interval in which revocation
may occur after evidence was issued. A trusted store read at authorization time is the
stronger alternative. Neither approach alone proves process liveness.

### Runtime Evidence Attestation / Lifecycle Freshness v0.1

Step 10 authenticates presented runtime authority without giving the Data Plane a
private key or adding I/O to the authorization function. Production code implements
verification only. An external Control Plane signer is responsible for producing
attestation envelopes; signing, issuance, and private-key custody are outside this
package.

```text
AttestedRuntimeBindingEvidence
  payload: RuntimeBindingArtifact   # all eight required fields
  attestation: AttestationEnvelope

AttestedAgentLifecycleEvidence
  payload: AgentLifecycleEvidencePayload
  attestation: AttestationEnvelope

AttestationEnvelope
  key_id
  signature_base64                  # canonical base64, exactly 64 decoded bytes

TrustedRuntimeAuthorizationContext
  authorization_time
  attestation_keys[]                # unique key_id + canonical Ed25519 SPKI DER
```

The trusted keyset is non-empty and may contain multiple keys during rotation. Every
key must be canonical DER/SPKI that parses specifically as Ed25519 and re-exports to
the identical bytes. Empty, duplicate-ID, malformed, non-canonical, or non-Ed25519
keysets invalidate the trusted context. The caller never supplies a verification key.

The Ed25519 preimage is byte-defined:

```text
UTF8(DOMAIN_TAG + "\n" + JSON.stringify(canonicalize(validated_payload)))
```

Only the strict schema-validated payload is signed. The envelope, key ID, and
signature are not part of the signed bytes. Payload fields are all required and use
only strings and integers; no optional or floating-point signed field is permitted.
The three versioned domain tags prevent type and role replay:

```text
agent-builder/attest/runtime-binding/v1
agent-builder/attest/lifecycle/acting/v1
agent-builder/attest/lifecycle/callee/v1
```

The runtime binding payload is the complete `RuntimeBindingArtifact`, including
`spec_id`, `version`, `content_hash`, deployment lease, runtime identity, and approval
artifact ID. The harness removes the presented spec's `content_hash`, recomputes it
using the existing canonical content-hash algorithm, and requires:

```text
recomputed_content_hash == spec.content_hash
recomputed_content_hash == runtime_binding_artifact.content_hash
```

Either failure maps to `runtime_binding_content_hash_mismatch`. Mutable runtime
metadata is not accepted in `RuntimeAuthorizationInput`; therefore no unsigned state,
subject, or deployment-binding projection can compete with the attested sources.

Lifecycle evidence is required for the acting spec on every action and semantically
required for the callee on agent calls. Its signed payload contains `spec_id`, the
exact concrete version or opaque channel key, `state`, `asserted_at`, and
`freshness_ttl`. The TTL is a positive whole second with a hard schema ceiling of 300
seconds. Freshness uses a half-open interval over absolute instants:

```text
fresh_until_ms = asserted_at_instant_ms + freshness_ttl * 1000

fresh when:
  asserted_at_instant_ms <= authorization_time_instant_ms < fresh_until_ms
```

There is deliberately no clock-skew grace in v0.1. Authorization before `asserted_at`
blocks as `lifecycle_evidence_not_fresh` with condition `from_future`; authorization
at or after `fresh_until` uses condition `expired`.

The closed reason catalog adds four codes:

- `attestation_key_unknown`, parameterized by evidence kind and key ID
- `attestation_invalid`, parameterized by evidence kind and key ID
- `lifecycle_evidence_subject_mismatch`, parameterized by acting/callee role
- `lifecycle_evidence_not_fresh`, parameterized by role and freshness condition

`runtime_subject_mismatch` now means signed runtime-binding artifact vs. presented
spec. `runtime_state_not_executable` reads signed acting lifecycle state.
`runtime_binding_content_hash_mismatch` represents either failed hash equality above.
The earlier `callee_lifecycle_subject_mismatch` code is retired in favor of the generic
role-bearing lifecycle reason.

Known v0.1 boundaries:

- Signed lifecycle freshness bounds evidence age but does not prove synchronous
  current state after `asserted_at`; there is no lifecycle store lookup.
- Call-graph approval artifacts remain caller-supplied and unsigned. Approval
  provenance attestation is implementation Step 11, not part of Step 10.
- Parent context spend-down is caller-owned in v0.1. The harness returns the authorized
  child context for an agent call; it does not mutate or return the parent context for
  later sibling calls.
- Call context, `current_run_id`, cycle chain, depth, and remaining budget are
  caller-supplied and unattested. Run identity and spend-down attestation is
  implementation Step 12.
- Process liveness is not proven. That requires heartbeat evidence, a runtime store,
  and a runtime lookup, none of which this slice performs.
- Key issuance, private-key custody, KMS/HSM, CRL or other key-revocation distribution,
  nonce replay storage, channel resolution, and real execution remain out of scope.

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

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
evidence for an agent-call target, decided and signed call-graph edge approval
artifacts, required signed run-context evidence, and a planned runtime action. Its
trusted context supplies the authorization instant and evidence-scoped Ed25519
public-key set. It returns
`allowed` or `blocked` and, for allowed agent-to-agent calls, an unsigned child
run-context draft for an external trusted resolver and signer.

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
- exact-subject signed run-context evidence carrying the sole run identity, call chain,
  and remaining-budget truth with at most 300 seconds of freshness
- semantic run topology, including the acting spec as the tail of `call_chain` and
  consistent root/parent/current-run relations
- cycle rejection using the full call chain
- exact-subject signed lifecycle evidence for agent-call targets, with only `deployed`
  currently callable and at most 300 seconds of freshness
- decided, full-artifact call-graph edge approval attestations, selected by exact
  caller/callee/version/channel identity and the acting spec's verified trust domain
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
  -> run-context attestation key known
  -> run-context signature valid
  -> run-context subject and recomputed content hash match
  -> run-context freshness
  -> run-context topology
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
  -> edge-evidence relevance prefilter over five signed subject fields
  -> every selected approval key known and authorized for its evidence kind
  -> every selected approval signature valid, in input order
  -> every selected approval decision/assertion causal
  -> every selected approval authority lease fresh at authorization_time
  -> verified evidence filtered to decision approved
  -> approved edge present
  -> exactly one canonical-authority lookup as of authorization_time
  -> lookup response trusted and bound to request
  -> canonical decision digest current and status active
  -> canonical duplicate collapse / defensive digest-collision ambiguity
  -> human gate
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

The edge prefilter is relevance-only: it may read the structurally validated signed
join fields, but no decision, human-gate, intent, data-share, depth, or budget field
before every selected artifact has passed attestation. Evidence outside the exact
five-field join is semantically ignored, even if its key or signature is invalid.
Selected evidence is verified and checked for authority causality and freshness
fail-closed in input order before rejected decisions are filtered out. Canonical
currency is evaluated only after that complete Step-13 chain succeeds.

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

AttestedRunContextEvidence
  payload: RunContextEvidencePayload
  attestation: AttestationEnvelope

AttestationEnvelope
  key_id
  signature_base64                  # canonical base64, exactly 64 decoded bytes

TrustedRuntimeAuthorizationContext
  authorization_time
  attestation_keys[]                # unique key_id + Ed25519 SPKI DER + allowed evidence kinds
```

The trusted keyset is non-empty and may contain multiple keys during rotation. Every
key must be canonical DER/SPKI that parses specifically as Ed25519, re-exports to the
identical bytes, and declares a non-empty duplicate-free `allowed_evidence_kinds`
list. Empty, duplicate-ID, malformed, non-canonical, non-Ed25519, or unscoped keysets
invalidate the trusted context. A key is trusted only for its explicitly listed
evidence kinds. `attestation_key_unknown` deliberately does not distinguish a missing
key ID from a present key that is not trusted for the requested evidence kind. The
caller never supplies a verification key.

The Ed25519 preimage is byte-defined:

```text
UTF8(DOMAIN_TAG + "\n" + JSON.stringify(canonicalize(validated_payload)))
```

Only the strict schema-validated payload is signed. The envelope, key ID, and
signature are not part of the signed bytes. Step-10 binding and lifecycle payload
fields are all required and use only strings and integers; no optional or
floating-point Step-10 signed field is permitted. Five versioned domain tags now
prevent type and role replay across Steps 10 through 13:

```text
agent-builder/attest/runtime-binding/v1
agent-builder/attest/lifecycle/acting/v1
agent-builder/attest/lifecycle/callee/v1
agent-builder/attest/approval/call-graph-edge/v2
agent-builder/attest/run-context/v1
```

The runtime derives domains only through a typed
`RUNTIME_ATTESTATION_DOMAIN_BY_EVIDENCE_KIND` map. Verification call sites provide an
evidence kind, not an independently paired domain. Adding a kind without a domain
therefore fails typecheck instead of creating a cross-type replay gap.

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

### Call-Graph Edge Approval Attestation v0.1

Step 11 removes raw `edge_approvals` from `RuntimeAuthorizationInput`. The replacement
is a required array, which may be empty:

```text
AttestedCallGraphEdgeApproval
  payload: DecidedCallGraphEdgeApproval
    type: call_graph_edge
    artifact_id
    requested_by
    decision: approved | rejected
    decided_by
    decided_at
    reason?                              # non-empty when present
    edge: AgentCallPolicyEdge            # complete edge, no projection
  attestation: AttestationEnvelope
```

`pending` is workflow state, not runtime authority, and is rejected at the structural
boundary. `decided_by` is non-empty and `decided_at` is RFC 3339 with an explicit
offset. The sole optional signed field is `reason`: omitted and explicit `undefined`
normalize to the same canonical JSON omission, `null` and the empty string are invalid,
and a present non-empty reason is signature-bound.

The domain is `agent-builder/attest/approval/call-graph-edge/v1`; its evidence kind is
`call_graph_edge_approval`. The payload is selected only for relevance before
attestation. The exact join is:

```text
edge.caller_spec_id == spec.spec_id
edge.caller_version == spec.version
edge.callee_spec_id == action.callee_spec_id
edge.callee_version_or_channel == action.callee_version_or_channel
edge.trust_domain_id == spec.trust_domain_id
```

For v0.1, an edge's scalar `trust_domain_id` denotes the caller's trust domain. The
spec side of that comparison is already protected by the recomputed spec hash and
attested runtime binding. Cross-domain reachability still requires a separate Control
Plane policy decision; this slice introduces no bridge-domain semantics.

Every relevant entry is verified in input order before its `decision` or any policy
field is read. An invalid relevant rejected artifact therefore still blocks; it is not
discarded before verification. After all relevant entries verify, rejected decisions
are removed. No remaining approved entry yields `call_edge_not_approved`; any
human-gated approved entry wins before ambiguity; multiple approved entries, including
duplicate presentation of one artifact, yield `ambiguous_call_edge_approval`.
Cryptographically invalid but subject-irrelevant evidence is ignored. Structurally
invalid evidence makes the full input invalid. Tool calls likewise ignore all
structurally valid edge evidence without inspecting keys, signatures, decisions, or
policy fields.

No new reason type is introduced. `attestation_key_unknown` and
`attestation_invalid` use evidence kind `call_graph_edge_approval`; the existing edge
policy reasons remain unchanged.

### Run Context / Run Identity Attestation v0.1

Step 12 removes raw `call_context` and `current_run_id` from
`RuntimeAuthorizationInput`. Their only authority source is required signed evidence:

```text
AttestedRunContextEvidence
  payload
    spec_id
    version
    content_hash
    current_run_id
    call_context
      root_run_id
      parent_run_id
      call_chain[]
      remaining_depth
      remaining_call_budget
      remaining_token_budget
      remaining_time_budget
    asserted_at
    freshness_ttl
  attestation
    key_id
    signature_base64
```

Run IDs are non-empty opaque strings. The payload is strict and uses evidence kind
`run_context` with domain `agent-builder/attest/run-context/v1`. Its subject is the
flat `spec_id`, `version`, and `content_hash` triple. `trust_domain_id` is not repeated:
it is immutable spec content and is already committed by the recomputed content hash.
Authorization requires:

```text
payload.spec_id == spec.spec_id
payload.version == spec.version
payload.content_hash == spec.content_hash
payload.content_hash == recompute_hash(spec_without_content_hash)
```

The signed `call_context` is the sole chain and remaining-budget input. Its call chain
is non-empty and contains spec IDs, not run IDs. The tail must equal the signed
`spec_id`. Root and child claims are semantically consistent only when:

```text
parent_run_id is null  <=>  current_run_id == root_run_id
parent_run_id is not null  =>  parent_run_id != current_run_id
```

Relational topology is evaluated only after key scope, signature, subject, and
freshness. It uses the closed conditions `call_chain_tail_mismatch`,
`root_parent_relation_invalid`, and `parent_equals_current`. Structural schema failure
remains `input_invalid`; semantic failures use `run_context_invalid`.

Freshness reuses the existing deterministic half-open evidence model with a separate
hard ceiling of 300 seconds:

```text
fresh_until_ms = asserted_at_instant_ms + freshness_ttl * 1000

fresh when:
  asserted_at_instant_ms <= authorization_time_instant_ms < fresh_until_ms
```

There is no skew grace and no implicit clock. The new semantic reasons are
`run_context_subject_mismatch`, `run_context_not_fresh` with condition `from_future`
or `expired`, and `run_context_invalid`. Generic `attestation_key_unknown` and
`attestation_invalid` carry evidence kind `run_context`; `call_context_invalid` is
retired.

An allowed tool call produces no context output. An allowed agent call returns only:

```text
AuthorizedChildRunContextDraft
  callee_spec_id
  callee_version_or_channel
  call_context                    # deterministically spent down from verified parent
```

The draft has no child run ID, resolved immutable callee version, content hash,
assertion time, TTL, key, or signature. It is not runtime authority. An external
trusted resolver must resolve the opaque callee version/channel and a signer must
issue a new `AttestedRunContextEvidence` for the child. The Harness verifies public
signatures only. This Step-12 boundary is pure and stateless; Step 15 later adds one
separate host-bound local authorization reservation without changing the draft into
runtime authority.

Run-context attestation proves the origin and integrity of the presented run claims.
It does not consume parent budget, prevent sibling or nonce replay, prove that the
claimed parent issued the child, attest current run identity, resolve channels, sign,
hold private keys, query a runtime store, or prove process liveness. Freshness narrows
the replay window but does not provide single-use semantics.

### Call-Graph Edge Approval Authority Lease v0.1

Step 13 time-bounds the runtime authority introduced by Step 11 without reusing the
approval decision timestamp as a lease. The runtime evidence shape is a breaking
replacement with a v2 signature domain:

```text
CallGraphEdgeApprovalEvidencePayload
  approval: DecidedCallGraphEdgeApproval
    type: call_graph_edge
    artifact_id
    requested_by
    decision: approved | rejected
    decided_by
    decided_at                         # immutable audit history
    reason?
    edge: AgentCallPolicyEdge
  asserted_at                          # authority assertion instant
  freshness_ttl                        # positive whole seconds, max 300

AttestedCallGraphEdgeApproval
  payload: CallGraphEdgeApprovalEvidencePayload
  attestation: AttestationEnvelope
```

The evidence kind remains `call_graph_edge_approval`; the signature domain changes to
`agent-builder/attest/approval/call-graph-edge/v2`. The version bump prevents a v1
signature over a bare `DecidedCallGraphEdgeApproval` from being accepted as a v2
authority lease. Both payload objects are strict. `decided_at` remains decision
history and never starts or renews runtime authority.

An authority assertion is internally coherent only when the embedded decision already
exists at the assertion instant:

```text
approval.decided_at_instant_ms <= asserted_at_instant_ms
```

The comparison uses absolute instants. Equal instants are valid. A later decision is
blocked as `call_graph_edge_approval_invalid` with condition
`decision_after_assertion`. RFC 3339 strings are not normalized before signing:
different offset spellings of the same instant remain different signature bytes while
producing the same temporal comparison result.

Freshness is deterministic and half-open, with no skew grace or implicit clock:

```text
fresh_until_ms = asserted_at_instant_ms + freshness_ttl * 1000

fresh when:
  asserted_at_instant_ms <= authorization_time_instant_ms < fresh_until_ms
```

Future and expired assertions use `call_graph_edge_approval_not_fresh`, parameterized
by `from_future` or `expired` plus the approval `artifact_id`. Invalid timestamp or TTL
shape remains `input_invalid`; key-purpose and signature failures retain the generic
attestation reasons.

Agent calls preserve the Step 11 dependency chain. The Harness selects candidates by
the five presented subject fields, verifies the signature over those exact selected
bytes, then checks decision/assertion causality and authority freshness. It performs
all of those checks for every relevant entry in input order before reading `decision`
or filtering rejected history. Subject-irrelevant evidence is not inspected beyond
structural input validation. Tool calls likewise ignore structurally valid edge
evidence entirely.

A stale or causally invalid relevant rejected artifact therefore blocks fail-closed.
Because the presenter chooses the evidence set, this permits presenter self-denial but
does not expand privilege. Rejection remains decision history, not revocation.

The lease narrows the replay window but proves neither the latest canonical decision
nor non-revocation inside the lease window, and it does not make an assertion
single-use. Closing those gaps requires a later canonical approval version/revocation
lookup and nonce or consumption storage.

### Canonical Edge Approval Validity / Revocation Lookup v0.1

Step 14 closes the canonical-currentness and revocation gaps as of the already trusted
`authorization_time`. It does not add caller-supplied snapshot fields to either the
runtime input or trusted context. Instead, the trusted composition root constructs one
async Runtime Authorizer with a host-bound, read-only canonical-authority resolver.
Planner, continuation, and resume state remain module-private; a TypeScript brand is
not treated as a security boundary and no Step-13 lease-only allow fallback exists.

The resolver is invoked exactly once only when the action is an `agent_call`, all
global and declaration guards pass, every subject-relevant approval artifact passes
Step-13 key-scope, signature, causality, and lease-freshness validation, and at least
one verified `approved` candidate remains. Tool calls, rejected-only history, and all
earlier failures perform no lookup.

The lookup key remains the exact five-field edge subject:

```text
caller_spec_id
caller_version
callee_spec_id
callee_version_or_channel
trust_domain_id
```

The runtime never selects a historical record by caller-supplied `artifact_id` or
revision. It requests one authoritative point-in-time view `as_of` the exact original
`authorization_time`. The result must echo the exact subject and `as_of` string and
carry an `observed_at` instant at or after `as_of`. `observed_at` is read audit
metadata only; it is not a second policy clock or freshness lease. A backend that
cannot prove a consistent historical view at `authorization_time` is unavailable and
blocks fail-closed.

The canonical record is strict:

```text
CanonicalAuthorityRecordV1
  subject: EdgeSubjectV1
  authority_revision: positive safe integer, monotone per subject
  approval_digest: 64 lowercase hex characters
  status: active | revoked
```

Every canonical authority-slot mutation increments `authority_revision`, including
revocation. Revocation preserves the revoked approval digest at the new revision. A
revoked slot is never reactivated in place; reactivation needs a new approved decision
and revision. Rejected decision history never mutates the authority slot. Runtime
currency does not trust or compare a presented revision; the revision remains store
audit ordering.

The decision digest is independent of the v2 authority-lease signature domain:

```text
domain = agent-builder/digest/call-graph-edge-approval/v1
canonical_decision = canonical_json(strict_parse(DecidedCallGraphEdgeApproval))
preimage = UTF8(domain + "\n" + canonical_decision)
approval_digest = lowercase_hex(SHA-256(preimage))
```

The digest covers the complete decided approval and embedded policy edge. It excludes
`asserted_at`, `freshness_ttl`, and the attestation envelope, so renewable leases over
the same immutable decision retain one decision identity. Digest canonicalization is
the same recursive key-sorting function used for runtime attestation preimages. The
v2 signature domain therefore remains unchanged.

After the lookup, absent authority blocks as
`call_graph_edge_approval_not_current / subject_absent`. No presented approved digest
matching the current record blocks as
`call_graph_edge_approval_not_current / authority_superseded`. A matching current
digest with status `revoked` blocks as `call_graph_edge_approval_revoked` before human
gate, intent, cycle, callee, depth, or budget guards. Timeout, resolver failure, and
untrustworthy response shape or binding block as
`approval_authority_lookup_unavailable`.

A lease-fresh superseded decision presented beside the lease-fresh current decision
does not create ambiguity: only the current digest survives. Repeated independently
validated evidence for identical canonical decision bytes is deduplicated. The
existing `ambiguous_call_edge_approval` reason remains only as defense in depth if one
digest ever corresponds to different canonical decision bytes. Invalid, causally
broken, or lease-stale relevant evidence still blocks before lookup and cannot be
made harmless by later currency filtering.

Step 14 proves canonical authority and non-revocation at `authorization_time`, not
through subsequent real execution. Revocation after that instant, single-use and nonce
consumption, parent-budget consumption, sibling replay, process liveness, channel
resolution, key custody, and real execution remain separate boundaries.

### Agent-Call Authorization Reservation Contract v0.1

Step 15 adds one state-changing Data Plane boundary without claiming execution. After
all existing global, Step-13, Step-14, human-gate, intent, cycle, callee-lifecycle,
depth, call-budget, and budget-monotonicity guards pass, the Runtime Authorizer invokes
one host-bound reservation adapter. No tool call or earlier blocked result reaches the
adapter.

The adapter is trusted infrastructure bound once at the composition root. Its
canonical-authority comparison and reservation insert must execute in one serializable
transaction or an equivalent single linearizable operation. TypeScript and factory
validation cannot prove that backend property; supplying a conforming adapter is a
host-composition requirement. The Harness invokes it exactly once. Any internal
serialization retry is adapter-private and must preserve the identical request and
atomic semantics.

The Harness derives four lowercase SHA-256 digests with the repository canonical JSON
rule:

```text
preimage = UTF8(domain + "\n" + canonical_json(strict_parse(value)))

agent-builder/digest/agent-call-reservation-run-context/v1
  -> strict RunContextEvidencePayload

agent-builder/digest/agent-call-reservation-action/v1
  -> complete strict AgentCallRuntimeAction

agent-builder/digest/agent-call-reservation-draft/v1
  -> strict AuthorizedChildRunContextDraft

agent-builder/digest/agent-call-authorization-reservation/v1
  -> strict AgentCallAuthorizationReservationBindingV1
```

The strict reservation binding contains the unchanged five-field `EdgeSubjectV1`, the
Step-14 expected authority revision and approval digest, verified `current_run_id`, all
three component digests, exact original `authorization_time`, and one derived
`authorization_valid_until_exclusive`. `reservation_id` is the fourth digest over that
complete binding and is never accepted from runtime input or trusted context.

The reservation deadline is the earliest absolute expiry among the runtime binding,
acting lifecycle evidence, run-context evidence, canonical-matching approval authority
evidence, and callee lifecycle evidence. Duplicate canonical approval decisions may
carry independently renewed Step-13 leases. After every relevant artifact has passed
its own Step-13 checks and currency filtering, the approval contribution uses the
maximum matching fresh-until instant because any one valid authority lease is
sufficient. The final deadline then takes the minimum against every other required
expiry. This rule is independent of presentation order.

The derived deadline is rendered exactly with ECMAScript `Date.prototype.toISOString()`
for the integer epoch-millisecond minimum: UTC, `Z`, and exactly three fractional
digits. The adapter uses its authoritative transaction instant and writes no
reservation when that instant is at or beyond the half-open deadline.

The strict adapter result is one of:

```text
reserved { receipt }
already_reserved { receipt }
subject_absent { observed_at }
authority_revoked { observed_at, current_authority_revision }
authority_superseded {
  observed_at,
  current_authority_revision,
  current_approval_digest
}
authorization_window_expired { observed_at }
unavailable { condition: store_error }
```

The adapter checks an existing `reservation_id` first. An exact stored binding returns
the original receipt, which recovers a reservation whose first response was lost. A
stored binding mismatch is untrustworthy. For a new reservation, missing authority is
absent; a lower current revision or a same-revision digest/status mismatch is
untrustworthy; a higher revision that revokes the same expected digest is revoked; all
other higher-revision or different-digest states are superseded. Exact expected
revision plus digest plus active status is eligible for the deadline check and insert.

The local receipt echoes every binding field plus `reservation_id` and the
store-authoritative `reserved_at`. The Harness recomputes the identifier, requires
every echo to match, and evaluates:

```text
authorization_time <= reserved_at < authorization_valid_until_exclusive
```

Only `reserved` and valid `already_reserved` return an allowed agent call. The receipt
is a peer of `child_run_context_draft`, never part of it. It is host/store-local and
non-portable. An exact retry may reconstruct an existing logical reservation after
authority later changes or the original window closes; that does not prove the receipt
is still safe to execute.

Step 14 and Step 15 are complementary rather than competing truths. Step 14 performs
one historical admission read as of exact `authorization_time`, selects the canonical
approval bytes, and supplies expected revision and digest. Step 15 performs one final
atomic comparison at its later transaction instant and inserts only if that exact
authority remains active and every bound lease remains open.

New fail-closed reasons are:

```text
agent_call_authorization_reservation_not_current
  condition: subject_absent | authority_superseded

agent_call_authorization_reservation_revoked

agent_call_authorization_reservation_window_expired

agent_call_authorization_reservation_indeterminate
  condition: timeout | adapter_error | store_error | response_untrustworthy
```

Reservation is not dispatch or consumption. Step 15 proves at most one logical local
reservation per deterministic authorization binding. It does not prove portable
receipt redemption, execution completion, or at-most-once execution.

Known v0.1 boundaries:

- Signed lifecycle freshness bounds evidence age but does not prove synchronous
  current state after `asserted_at`; there is no lifecycle store lookup.
- A presented decided call-graph approval now has authenticated origin, integrity, a
  maximum 300-second authority lease, and canonical current/non-revoked status as of
  `authorization_time`. A successful agent-call authorization also has one atomic local
  reservation while every required lease is still open, but the Harness does not prove
  that its receipt stays unrevoked or is redeemed only once by a later executor.
- Parent context, `current_run_id`, cycle chain, depth, and remaining budgets are now
  authenticated as presented evidence. The harness still does not mutate or return a
  consumed parent context for later sibling calls, so aggregate sibling spend-down is
  not proven.
- Process liveness is not proven. That requires heartbeat evidence, a runtime store,
  and a lifecycle-specific runtime lookup. The Step-15 reservation adapter provides
  none of those liveness semantics.
- Key issuance, private-key custody, KMS/HSM, CRL or other key-revocation distribution,
  parent-budget consumption, sibling spend-down/replay, tool-call reservation, receipt
  redemption, channel resolution, and real execution remain out of scope.

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

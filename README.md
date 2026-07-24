# agent-builder

`agent-builder` is a TypeScript prototype for a control-plane-first builder agent.

The attended-local, bounded continuation protocol is documented in
[`docs/architecture/autonomous-roadmap-orchestration-v0.1.md`](docs/architecture/autonomous-roadmap-orchestration-v0.1.md).
Its machine-readable roadmap records the merge-backed Step 1-15 baseline and the single
current Step 16 candidate. It never turns Claude, a model router, or an implementation
driver into a Control Plane authority.
The attended controller advances persisted runs only through a locked contract and then
returns an explicit external-implementation boundary.
The separate
[`Host Workflow Adapter Contract v0.1`](docs/architecture/host-workflow-adapters-v0.1.md)
extends the persisted composition through `step_complete` using strict injected-adapter
contracts and deterministic fakes. Its real pinned Claude CLI adapter negotiates the v2
contract, but it ships no real Git, GitHub, or verification subprocess runner; an
unprotected default branch blocks merge as `merge_authority_missing` without bypass.
The Claude-locked
[`Roadmap Base Reconciliation Contract v0.1`](docs/architecture/roadmap-base-reconciliation-v0.1.md)
adds a bounded, digest-bound transparent-governance chain proof so a later domain step
can retain its immutable roadmap anchor while binding execution to the exact current
`origin/main`. It does not implement Step 16 or real host runners.
Its job is not to execute agents directly. It turns builder intent into validated,
versioned agent specifications, evaluates them against policy, and produces auditable
approval decisions without deploying or executing the resulting agents.

The core boundary is:

> The Builder Agent proposes specs. The Control Plane grants capabilities, edges,
> and lifecycle states. The Data Plane executes only approved, versioned bindings.

## Architecture

The implemented control-plane flow is:

```text
BuilderIntentDraft
  -> Spec Assembler
  -> immutable AgentSpecContent
  -> Policy / Evaluation Harness
  -> Deployment Gate
  -> approved or rejected lifecycle metadata + audit artifact
  -> Runtime Binding
  -> deployed lifecycle metadata + binding artifact
```

The flow binds approved content to runtime metadata, but still never starts real
infrastructure. Runtime deployment and agent execution remain outside this
package's current scope.

The implemented Data Plane authorization slice is:

```text
approved AgentSpecContent
  + AttestedRuntimeBindingEvidence
  + required AttestedAgentLifecycleEvidence for the acting spec
  + AttestedCallGraphEdgeApproval artifacts
  + required AttestedRunContextEvidence
  + planned RuntimeAction
  + TrustedRuntimeAuthorizationContext (authorization time + evidence-scoped public keyset)
  + AttestedAgentLifecycleEvidence for agent-call targets
  -> Runtime Harness
  -> allowed or blocked authorization result
```

The Runtime Harness does not execute tools, call agents, or deploy specs. It proves
whether a planned runtime action is authorized by already-approved, versioned
bindings and, for an otherwise allowed agent call, delegates one atomic local
authorization reservation to a host-bound trusted adapter.

## What Is Implemented

- Zod schemas for control-plane artifacts:
  - `BuilderIntentDraft`
  - `AgentSpecContent`
  - `AgentSpecRuntimeMetadata`
  - `AgentCallPolicyEdge`
  - `TrustDomain`
  - `ApprovalArtifact`
  - `CallContext`
- A pure spec assembler that:
  - validates builder drafts at the trust boundary
  - resolves requested callee roles to concrete approved spec versions
  - assigns the next immutable version
  - computes a deterministic content hash
- A policy harness that:
  - rejects forbidden tool combinations
  - checks trust-domain membership
  - classifies capability deltas
  - requires evaluation for initial or capability-expanding specs
  - binds every decision to the evaluated spec ID, version, and content hash
  - validates evaluation outcomes and retains decision evidence
- A deployment gate that:
  - accepts only specs in the `in_review` lifecycle state
  - verifies candidate, policy subject, and runtime metadata refer to the same spec
  - enforces separation of duties between requestor and approver
  - emits schema-validated approval evidence and lifecycle transitions
  - fails closed when required evaluation evidence is missing
- A runtime binding executor boundary that:
  - accepts only specs already in the `approved` lifecycle state
  - validates spec, metadata, approval artifact, and trusted binding context
  - binds runtime metadata back to the approved `contentHash`
  - emits an immutable `RuntimeBindingArtifact`
  - transitions lifecycle metadata from `approved` to `deployed`
  - blocks existing deployment bindings instead of overwriting them
  - never starts real infrastructure or writes runtime state
- A runtime authorization harness that:
  - validates the full runtime authorization input at the boundary
  - requires an explicit trusted authorization instant and evidence-scoped Ed25519
    public-key set with no system-clock or caller-key fallback
  - requires every trusted key to declare the exact evidence kinds it may verify;
    an absent or wrongly scoped key is indistinguishably fail-closed
  - derives every attestation domain from one typed evidence-kind/domain map so a
    newly added evidence kind cannot silently drift at individual call sites
  - verifies a domain-separated Ed25519 signature over the complete
    `RuntimeBindingArtifact`
  - recomputes the presented immutable spec content hash and requires it to match
    both the spec and the signed artifact
  - evaluates the signed runtime binding over the half-open lease interval
    `deployedAt <= authorizationTime < deployedAt + ttl`
  - removes mutable runtime metadata from the authorization input and takes acting
    lifecycle state only from required signed evidence
  - verifies acting and callee lifecycle evidence with role-specific signature domains
    and a maximum 300-second half-open freshness lease
  - accepts only acting state `deployed` as executable and callee state `deployed` as
    callable while keeping those policy concepts separate
  - rejects future-dated lifecycle assertions without clock-skew grace
  - removes raw call context and run identity from the authorization input and accepts
    them only inside required, signed, content-bound `AttestedRunContextEvidence`
  - verifies run-context subject, half-open freshness, acting-spec chain tail, and
    root/parent/current-run relations before any planned action guard
  - authorizes tool calls only by exact declared tool/scope matches
  - authorizes agent calls only through complete, decided, Ed25519-attested
    call-graph edge approval authority assertions
  - separates immutable approval history (`decidedAt`) from a renewable, maximum
    300-second authority lease (`assertedAt` plus `freshnessTtl`)
  - requires the embedded decision to exist no later than its authority assertion
    and evaluates the lease as a half-open absolute-instant interval
  - prefilters edge evidence only by the signed caller/callee/version/channel subject
    plus the acting spec's verified caller trust domain, then verifies every selected
    entry, its decision/assertion causality, and its freshness before reading its
    decision or policy fields
  - ignores cryptographically invalid but subject-irrelevant edge evidence while
    failing closed on every selected entry in input order
  - binds one canonical-authority resolver at the trusted composition root and
    performs exactly one point-in-time lookup only after at least one relevant
    `approved` authority candidate passes every Step-13 guard
  - queries the existing five-field edge subject exactly as of the same injected
    `authorizationTime` used by binding, lifecycle, run-context, and authority-lease
    checks; lookup failure, timeout, malformed output, or request/result drift blocks
    fail-closed without a lease-only fallback
  - compares fully verified approved candidates with a domain-separated SHA-256
    digest of the complete decided approval and rejects absent, superseded, or
    explicitly revoked canonical authority
  - deduplicates repeated presentation of the same canonical decision and uses the
    canonical digest to discard lease-fresh superseded decisions before policy guards
  - requires intents to be allowed by both the spec declaration and approved edge
  - matches the opaque `versionOrChannel` lifecycle subject exactly without resolving
    channels
  - ignores structurally valid callee lifecycle evidence for tool calls while still
    rejecting malformed evidence at the input boundary
  - likewise ignores structurally valid edge approval evidence for tool calls without
    inspecting its key, signature, decision, or policy fields
  - reserves ambiguous edge blocking for the defense-in-depth case where one digest
    maps to different canonical decision bytes
  - blocks human-gated edges fail-closed
  - derives an unsigned child run-context draft only for allowed agent calls; an
    external trusted resolver and signer must assign the child identity and authority
  - enforces runtime budget monotonicity across call, token, and time budgets
  - derives domain-separated SHA-256 identities for the verified run-context payload,
    complete agent-call action, deterministic child-context draft, and complete
    reservation binding without accepting a caller-supplied reservation identifier
  - computes one canonical UTC reservation deadline as the earliest required binding
    or evidence expiry, using the freshest independently valid lease among duplicate
    canonical approval evidence without input-order selection
  - invokes one host-bound atomic authorization-reservation adapter only after every
    pure agent-call guard passes; canonical-authority comparison and reservation insert
    must share one serializable or equivalently linearizable operation
  - returns an allowed agent call only for a strict `reserved` or exact
    `already_reserved` receipt bound to every request field and the store-authoritative
    reservation instant; timeout, adapter/store failure, malformed output, authority
    change, or an expired authorization window remains fail-closed
  - keeps the local reservation receipt beside, never inside, the unsigned child
    run-context draft; it is not portable authority and proves neither dispatch nor
    at-most-once execution
- Runtime/control invariants for:
  - executable-boundary checks
  - call-graph cycle detection
  - budget monotonicity across call chains
  - capability delta classification

See [docs/architecture/agent-builder-control-plane.md](docs/architecture/agent-builder-control-plane.md)
for the architecture and rejected shortcuts.

## Repository Layout

```text
src/
  assembler/    Draft-to-spec assembly and role resolution
  deployment/   Runtime binding and deployment-executor boundary
  gate/         Approval decisions and lifecycle transitions
  harness/      Policy and evaluation decisions
  invariants/   Cross-cutting control-plane invariants
  runtime/      Data-plane authorization and call-context derivation
  schema/       Zod schemas and exported TypeScript types
tests/
  assembler/    Assembly behavior
  deployment/   Runtime-binding behavior
  gate/         Deployment-gate behavior
  harness/      Policy decision behavior
  invariants/   Invariant checks
  runtime/      Runtime authorization behavior
  schema/       Schema validation behavior
docs/
  architecture/ Control-plane design notes
```

`docs/learning/` is treated as local generated learning material and is ignored
for new files.

## Requirements

- Node.js
- pnpm 11.16.0, as declared in `package.json`

Install dependencies:

```bash
pnpm install
```

## Development

Run the test suite:

```bash
pnpm test
```

Run TypeScript checks:

```bash
pnpm typecheck
```

Run tests in watch mode:

```bash
pnpm test:watch
```

## Design Constraints

This package intentionally keeps several capabilities out of scope:

- no direct deployment by the Builder Agent
- no executable specs
- no wildcard tool or agent-call grants
- no unresolved role expressions in final `AgentSpecContent`
- no global/shared credentials
- no agent-to-agent calls without explicit approved edges
- no evaluation shortcut for "simple" agents
- no approval directly from the `draft` lifecycle state
- no self-approval by the spec requestor
- no approval without policy-subject and content-hash binding
- no runtime binding without approved content-hash-bound approval
- no runtime binding overwrite/redeploy in v0.1
- no implicit runtime clock or `Date.now()` fallback during authorization
- no metadata mutation or lifecycle transition when a runtime binding expires
- no process-liveness claim without a heartbeat, runtime store, and runtime lookup
- no private-key custody, signing, issuance, KMS/HSM, CRL, or key-registry lookup
- no nonce/replay store or synchronous lifecycle-state lookup; signed freshness narrows
  but cannot eliminate the post-assertion revocation window
- no clock-skew grace for future-dated lifecycle evidence in v0.1
- no channel resolution or process-liveness claim from lifecycle evidence
- no claim that canonical edge authority remains unrevoked after the injected
  `authorizationTime` without a successful final reservation; even a successful
  reservation does not prove that authority remains unrevoked until real execution
- no single-use edge authority or nonce consumption; canonical currentness and
  one logical reservation per deterministic authorization attempt do not prevent a
  later executor from presenting or executing the local receipt repeatedly
- no parent-budget consumption, sibling/nonce replay protection, or proof that a
  presented parent run actually issued a child context; those require a runtime store
  or parent-decision linkage beyond signed run-context integrity
- no runtime budget increases along a call chain
- no runtime authorization from raw, caller-supplied call-graph edges
- no array-order selection among matching call-graph approvals; only the canonical
  decision digest may select the policy-bearing edge
- no tool-scope containment inference without a structured scope model

These constraints are enforced in code where the current prototype has enough local
context, and documented as control-plane requirements where a future registry,
real deployment executor, or runtime store is needed.

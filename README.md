# agent-builder

`agent-builder` is a TypeScript prototype for a control-plane-first builder agent.
Its job is not to execute agents directly. It turns builder intent into validated,
versioned agent specifications and checks whether those specifications are safe to
approve.

The core boundary is:

> The Builder Agent proposes specs. The Control Plane grants capabilities, edges,
> and lifecycle states. The Data Plane executes only approved, versioned bindings.

## Architecture

![Secure Control Plane Architecture Diagram](docs/learning/pr-001-control-plane-schema-assembler/Secure_Control_Plane_Architecture_Diagram.png)

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
  harness/      Policy evaluation helpers
  invariants/   Cross-cutting control-plane invariants
  schema/       Zod schemas and exported TypeScript types
tests/
  assembler/    Assembly behavior
  harness/      Policy decision behavior
  invariants/   Invariant checks
  schema/       Schema validation behavior
docs/
  architecture/ Control-plane design notes
```

`docs/learning/` is treated as local generated learning material and is ignored
for new files, except for the architecture diagram embedded in this README.

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
- no runtime budget increases along a call chain

These constraints are enforced in code where the current prototype has enough local
context, and documented as control-plane requirements where a future registry,
deployment gate, or runtime harness is needed.

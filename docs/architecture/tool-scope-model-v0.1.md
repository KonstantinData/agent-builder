# Tool Scope Model v0.1

Status: structural foundation; no runtime containment enablement.

## Purpose

`AgentSpecContent` v0.1 stores tool scopes as wildcard-free opaque strings. The Runtime
Harness therefore authorizes only exact `toolId` and scope-string matches. This contract
adds a versioned, strict structural representation so a future scope algebra has an
explicit, auditable starting point. It does not alter existing specs or their runtime
meaning.

The Builder proposes scope data; only the Control Plane can approve a versioned spec.
Neither this parser, a model, nor a Data Plane caller creates authority.

## Model

The structured representation is:

```text
ToolScope v0.1
  modelVersion: "tool-scope/1"
  toolId: closed ToolId catalog entry
  tenantId: non-empty wildcard-free identifier
  selectors[]: sorted, unique entries from { namespace, resource, subject }
```

Selector keys are deliberately closed and sorted in strictly ascending key order. The
parser rejects duplicate keys, unknown keys or fields, wildcard characters, and
non-canonical order. This prevents semantically equivalent inputs from producing
different content hashes or evidence digests.

The catalog is structural, not an assertion that a selector has the same meaning for
every tool. `http.fetch`, filesystem, database, mail, and CRM adapters need different
resource semantics. A generic prefix or path comparison would be an unsafe authority
inference.

## Comparison and legacy compatibility

`compareToolScopes` returns only `equal`, `disjoint`, or `indeterminate` in v0.1.

- Different closed `toolId`s are `disjoint`.
- Same-version, byte-identical canonical scopes are `equal`.
- Different structured scopes, cross-model inputs, and different legacy strings are
  `indeterminate`.
- Historical strings are represented by `legacy-exact/1` and retain exact-only meaning.

No comparison result is an authorization decision. In particular, `indeterminate`
blocks any future containment claim. This package adds no `narrower` result and does
not modify Runtime Harness matching, policy approval, deployment, host adapters, or
external execution.

## Required future decision before enablement

A later, separately accepted contract must define a closed, per-tool resource taxonomy
and comparison semantics before it may add `narrower`/`broader` or consume them in the
Runtime Harness. It must also prove conservative delta classification, versioned
migration of immutable specs, and fail-closed behavior for unknown adapter state.

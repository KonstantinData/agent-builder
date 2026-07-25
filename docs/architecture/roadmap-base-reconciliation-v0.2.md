# Roadmap Base Reconciliation Policy v0.2

Status: attended policy correction for the PR 20 historical merge record.

The machine-readable artifact is `contracts/roadmap-base-reconciliation-v0.2.json`.
This policy supersedes v0.1 only for new selection; it does not mutate v0.1 proof,
event, snapshot, or contract replay.

## Narrow migration rule

The transparent governance chain increases from four to five records solely because
PR 20 was merged with GitHub's merge-commit method before merge-method restriction was
enabled. A v2 proof accepts a non-squash record only when every pinned PR 20 field
matches exactly: PR number, parent, merge commit, PR head, merge instant, and complete
sorted changed-path list. The normal source, merged-state, tree-match, exact-head
`verify`, workflow-manifest, capability, deployment, and path constraints still apply.

Every other record must be a GitHub pull-request squash merge. Duplicate PR, head, or
merge provenance; chain gaps; an unpinned PR 20 field; a second merge commit; a sixth
record; policy/proof version mismatch; or a changed `origin/main` all stop selection
fail closed.

The policy-migration pull request is the fifth record and must itself be squash merged.
Repository merge settings now disallow merge commits and rebase merges; this does not
weaken required review, exact-head `verify`, branch protection, PR, CI, or merge gates.

## Durable compatibility

`roadmap-base-reconciliation-proof/1` remains valid only with roadmap policy v1.
`roadmap-base-reconciliation-proof/2` remains valid only with roadmap policy v2. The
reducer persists either validated proof using the existing compact binding and refuses
malformed or cross-version evidence before a step can be selected or implemented.

## Non-claims

This is a history-reconciliation correction only. It does not start Step 16, create a
real repository inspector or host runner, hold credentials, alter branch protection,
or authorize a direct merge or bypass.

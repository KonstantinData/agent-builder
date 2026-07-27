# Builder Security Baseline v1

Status: **Implemented** on 2026-07-27.

The required CI controls are: frozen dependency installation, TypeScript and
test verification, a tracked Node patch version, SHA-pinned GitHub Actions,
the repository secret-pattern and action-pin check, and a production dependency
audit that blocks High and Critical advisories. Dependabot checks npm and
GitHub Action updates weekly.

The baseline is fail-closed: an unpinned Action, detected credential pattern,
dependency-audit failure, or unavailable check fails the security job. It does
not claim that a local pattern check replaces a managed secret-scanning service
or that an audit proves absence of all supply-chain risk. Package acceptance
will consume the resulting GitHub run URL and commit-bound check result.

# Supply-chain and CI Evidence Policy v0.1

> Status: **Proposed.** Tool selection, exception authority and branch-protection changes
> require repository-security-owner acceptance. This policy is not a production claim.

## Minimum controls

| Control | Required evidence |
| --- | --- |
| Reproducible install | exact Node patch, pinned pnpm, frozen lockfile and lock-drift check |
| Dependency risk | direct/reachable High/Critical findings block unless an expiry-bound exception exists |
| Secret detection | PR, push and scheduled scan; no secret value in logs or artifacts |
| Action integrity | full immutable action SHAs, least-privilege tokens and reviewed updates |
| Code scanning | High/Critical findings block; reviewed expiry-bound suppressions only |
| SBOM/license | deterministic CycloneDX or SPDX from lockfile with schema and package-set validation |
| Evidence | run URL, commit SHA, tool version, result and artifact digest; retained by policy |

Dependabot plus OSV scanner (or equivalent), Gitleaks, CodeQL/Semgrep, CycloneDX/Syft
and action pinning tooling are candidate implementations; acceptance selects one versioned
toolchain. GitHub secret scanning is defense in depth, not the sole policy control.

## Fail-closed exception policy

Secret findings, lock drift, unpinned actions and unapproved High/Critical findings block.
Medium/low exceptions require finding ID, affected digest/version, compensating control,
accountable owner, expiry, review date and removal condition. Scanner/advisory/SBOM/evidence
unavailability is `unknown`, not pass, and blocks the affected security gate.

## Required repository artifacts

Expected implementation artifacts are `.node-version`, `SECURITY.md`, Dependabot config,
security workflow, CI policy checks, security policy and exception documents, and an evidence
artifact index. Provenance attestation applies only once an accepted distributable release
artifact exists. Tests must demonstrate lock drift, unpinned action, fixture secret,
High/Critical finding/expired exception, valid SBOM and head-bound PR evidence handling.

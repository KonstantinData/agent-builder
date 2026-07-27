# Versioned Agent Package v1

Status: **Accepted** on 2026-07-27.

`buildAgentPackage` creates a deterministic closed ZIP entirely in memory. It
contains the immutable spec, the matching approval, evaluation evidence, and a
SHA-256 manifest. The filename contains the exact spec ID and version. It does
not write a customer package into this repository, select a server, or deploy.

The function rejects evidence not bound to the same `{specId, version,
contentHash}` and rejects known credential or customer-configuration markers.
The caller receives ZIP bytes plus digest for external delivery only.

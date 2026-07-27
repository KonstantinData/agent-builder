# Versioned Agent Package v1

Status: **Accepted** on 2026-07-27.

`buildAgentPackage` creates a deterministic closed ZIP entirely in memory. It
contains the immutable spec, the matching approval, evaluation evidence, and a
SHA-256 manifest. The filename contains the exact spec ID and version. It does
not write a customer package into this repository, select a server, or deploy.

The function rejects evidence not bound to the same `{specId, version,
contentHash}` and rejects known credential or customer-configuration markers.
The caller receives ZIP bytes plus digest for external delivery only. Before a
package can pass Builder readiness, the gate parses the actual ZIP bytes
fail-closed: it validates local and central ZIP records, CRCs, the exact closed
entry set, the embedded manifest, and every artifact SHA-256 digest. Metadata
supplied beside the ZIP is checked against that embedded evidence and is never
accepted as a substitute for it.

The Builder recomputes the canonical Spec content hash before packaging. ZIP
verification reparses the embedded Spec and recomputes that same hash before
accepting its manifest subject. A declared but stale or forged content hash is
therefore rejected at both trust boundaries.

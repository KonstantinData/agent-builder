# Builder Delivery Readiness v1

Status: **Accepted** on 2026-07-27.

`evaluateDeliveryReadiness` is the final Builder-side gate. It returns ready
only for one closed ZIP package when the guided briefing is complete, the
actual ZIP bytes verify their embedded manifest and required artifact digests,
the package has an identifiable versioned subject and digest, and recorded
commit-bound CI evidence confirms both the security baseline and dependency
audit. The gate rejects malformed ZIP structures, duplicate or missing entries,
CRC failures, or a manifest that does not match extracted artifact bytes.
It also recomputes the canonical content hash of both the supplied Spec and the
embedded package Spec, rejecting a declared hash that does not match content.
It additionally compares the verified embedded approval and evaluation with
the evidence supplied to the gate, preventing approval replay or evidence
replacement after packaging.

The result never deploys, uploads, selects a target, changes a customer agent,
or authorises server access. It is a narrow statement that the exact ZIP is
ready to hand to the separate Deploy Tool.

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

## Executable composition

`composeBuilderDelivery` is the single Builder-side composition entry point for
v0.1 delivery preparation. It accepts a signed completed briefing, immutable
template and adaptation, injected assembly and policy contexts, an evaluation
provider, an already-attested human gate context, and commit-bound security
evidence. It never accepts a caller-supplied Spec, policy verdict, evaluation,
approval, package, manifest, or ZIP bytes.

The function derives the draft only from the validated adaptation, assembles a
new immutable Spec, passes that exact object to the evaluator, evaluates the
returned evidence against policy, and runs the deployment gate using only the
evidence retained by that policy decision. It builds the ZIP only from the
gate's approved artifact and then evaluates readiness with the internally
created package. Any malformed, foreign, replayed, rejected, or substituted
stage result fails closed.
The composition is still preparation only; it creates no deployment authority.

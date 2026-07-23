/**
 * Opaque, already-attested approval principal (Step 5, Vertrag C).
 *
 * A `VerifiedApprovalPrincipal` may only exist if a trusted control-plane
 * component attested it *outside* this v0.1 slice. There is deliberately NO
 * production factory here: the brand symbol below is module-private and never
 * exists at runtime, so the type cannot be constructed without a `cast`, and
 * the only cast in the whole repository lives in `tests/support/`. This keeps
 * the trust boundary honest — the builder can never mint an approver identity.
 *
 * When the real attestation layer (token/signature verification) lands, it
 * replaces the test-only construction seam without changing this gate contract.
 */
declare const PrincipalBrand: unique symbol;

export interface VerifiedApprovalPrincipal {
  readonly principalId: string;
  readonly role: "approver";
  readonly [PrincipalBrand]: true;
}

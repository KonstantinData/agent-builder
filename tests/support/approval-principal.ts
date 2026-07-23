import type { VerifiedApprovalPrincipal } from "../../src/gate/approval-principal.js";

/**
 * Test-only attestation seam. This is the ONLY place in the repository that
 * constructs a VerifiedApprovalPrincipal, and the only `as`-cast onto that type.
 * Production code has no factory — a real principal must come from the (not yet
 * built) control-plane attestation. Keeping this outside `src/` makes the trust
 * boundary auditable: grep for `as VerifiedApprovalPrincipal` finds exactly one
 * hit, here.
 */
export const makeTestPrincipal = (principalId: string): VerifiedApprovalPrincipal =>
  ({ principalId, role: "approver" }) as VerifiedApprovalPrincipal;

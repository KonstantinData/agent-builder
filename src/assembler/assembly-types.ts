import type { AgentSpecContent } from "../schema/agent-spec-content.js";
import type { SpecId, TrustDomainId } from "../schema/common.js";
import type { TrustDomain } from "../schema/trust-domain.js";

/**
 * Pure/injected context (Step 3 scope): all candidates the assembler may
 * resolve against are passed in directly. No registry lookup, no DB, no
 * runtime.
 */
export interface AssemblyContext {
  readonly approvedSpecs: readonly AgentSpecContent[];
  readonly trustDomains: readonly TrustDomain[];
}

/**
 * Minimal, serializable projection of a Zod issue — deliberately not Zod's own
 * issue type, so `RejectionReason` stays independent of Zod's internals.
 */
export interface SchemaIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

export type RejectionReason =
  | { readonly type: "schema_validation_failed"; readonly issues: readonly SchemaIssue[] }
  | { readonly type: "trust_domain_not_found"; readonly trustDomainId: TrustDomainId }
  | { readonly type: "unresolved_callee_role"; readonly calleeRole: string }
  | {
      readonly type: "ambiguous_callee_role";
      readonly calleeRole: string;
      readonly matchingSpecIds: readonly SpecId[];
    }
  | { readonly type: "content_validation_failed"; readonly issues: readonly SchemaIssue[] };

export type AssemblyResult =
  | { readonly success: true; readonly content: AgentSpecContent }
  | { readonly success: false; readonly reasons: readonly RejectionReason[] };

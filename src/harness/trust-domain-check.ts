import type { AgentSpecContent } from "../schema/agent-spec-content.js";
import type { ToolId } from "../schema/common.js";
import type { TrustDomain } from "../schema/trust-domain.js";
import type { PolicyRejectionReason } from "./harness-types.js";

/**
 * `allowedToolClasses` is a free string (NoWildcardStringSchema), not the
 * closed ToolId enum — there is no separate tool-taxonomy layer yet. v0.1
 * interpretation: a "class" string equals an exact `toolId` string.
 */
function findToolViolations(candidate: AgentSpecContent, domain: TrustDomain): PolicyRejectionReason[] {
  const disallowed = new Set<ToolId>();
  for (const tool of candidate.declaredTools) {
    if (!domain.allowedToolClasses.includes(tool.toolId)) {
      disallowed.add(tool.toolId);
    }
  }
  return [...disallowed].map((toolId) => ({
    type: "tool_not_allowed_in_domain" as const,
    toolId,
    trustDomainId: domain.domainId,
  }));
}

function findRoleViolations(candidate: AgentSpecContent, domain: TrustDomain): PolicyRejectionReason[] {
  const disallowed = new Set<string>();
  for (const role of candidate.declaredRoles) {
    if (!domain.allowedAgentRoles.includes(role)) {
      disallowed.add(role);
    }
  }
  return [...disallowed].map((role) => ({
    type: "role_not_allowed_in_domain" as const,
    role,
    trustDomainId: domain.domainId,
  }));
}

/**
 * If the domain itself doesn't exist, tool/role checks are meaningless and
 * skipped — only `trust_domain_not_found` is reported. Empty
 * `allowedToolClasses`/`allowedAgentRoles` mean default-deny (nothing
 * allowed), consistent with the closed-catalog, no-wildcard-grant philosophy
 * used throughout the rest of the schema.
 */
export function checkTrustDomainCompliance(
  candidate: AgentSpecContent,
  trustDomains: readonly TrustDomain[],
): PolicyRejectionReason[] {
  const domain = trustDomains.find((d) => d.domainId === candidate.trustDomainId);
  if (!domain) {
    return [{ type: "trust_domain_not_found", trustDomainId: candidate.trustDomainId }];
  }
  return [...findToolViolations(candidate, domain), ...findRoleViolations(candidate, domain)];
}

import { describe, expect, it } from "vitest";
import { checkTrustDomainCompliance } from "../../src/harness/trust-domain-check.js";
import {
  domainSales,
  roleNotAllowedChildSpecContent,
  toolNotAllowedChildSpecContent,
  validAgentSpecContent,
} from "../fixtures/specs.js";

describe("checkTrustDomainCompliance", () => {
  it("returns no reasons when every declared tool and role is allowed", () => {
    expect(checkTrustDomainCompliance(validAgentSpecContent, [domainSales])).toEqual([]);
  });

  it("returns only trust_domain_not_found when the domain doesn't exist, skipping tool/role checks", () => {
    const reasons = checkTrustDomainCompliance(validAgentSpecContent, []);
    expect(reasons).toEqual([{ type: "trust_domain_not_found", trustDomainId: "domain-sales" }]);
  });

  it("flags a tool that isn't in the domain's allowedToolClasses", () => {
    const reasons = checkTrustDomainCompliance(toolNotAllowedChildSpecContent, [domainSales]);
    expect(reasons).toEqual([
      { type: "tool_not_allowed_in_domain", toolId: "email.send", trustDomainId: "domain-sales" },
    ]);
  });

  it("flags a role that isn't in the domain's allowedAgentRoles", () => {
    const reasons = checkTrustDomainCompliance(roleNotAllowedChildSpecContent, [domainSales]);
    expect(reasons).toEqual([
      { type: "role_not_allowed_in_domain", role: "unlisted-role", trustDomainId: "domain-sales" },
    ]);
  });
});

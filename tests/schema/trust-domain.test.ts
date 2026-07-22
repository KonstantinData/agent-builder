import { describe, expect, it } from "vitest";
import { TrustDomainSchema } from "../../src/schema/trust-domain.js";

const validTrustDomain = {
  domainId: "domain-sales",
  owner: "sales-platform-team",
  allowedDataClasses: ["lead-record", "contact-info"],
  allowedToolClasses: ["crm.enrich"],
  allowedAgentRoles: ["crm-enricher", "web-search-agent"],
  crossDomainRules: ["billing:read-only"],
};

describe("TrustDomainSchema", () => {
  it("accepts a valid trust domain definition", () => {
    expect(TrustDomainSchema.safeParse(validTrustDomain).success).toBe(true);
  });

  it("rejects a wildcard in allowedDataClasses", () => {
    const candidate = { ...validTrustDomain, allowedDataClasses: ["*"] };
    expect(TrustDomainSchema.safeParse(candidate).success).toBe(false);
  });
});

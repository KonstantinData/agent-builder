import { z } from "zod";
import { NoWildcardStringSchema, TrustDomainIdSchema } from "./common.js";

/**
 * Section 9: Trust Domains are their own Control Plane artifact, not a free
 * string on a call-graph edge.
 */
export const TrustDomainSchema = z
  .object({
    domainId: TrustDomainIdSchema,
    owner: z.string().min(1),
    allowedDataClasses: z.array(NoWildcardStringSchema),
    allowedToolClasses: z.array(NoWildcardStringSchema),
    allowedAgentRoles: z.array(z.string().min(1)),
    crossDomainRules: z.array(z.string().min(1)),
  })
  .strict();
export type TrustDomain = z.infer<typeof TrustDomainSchema>;

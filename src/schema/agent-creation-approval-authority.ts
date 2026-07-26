import { z } from "zod";

/**
 * V0.1 identities for the agent-creation contract. These literals are policy
 * subjects, not credentials or local identity verification. A separately
 * trusted host must attest a principal before the Deployment Gate receives it.
 */
export const AGENT_CREATION_APPLICANT_ID = "agent-builder" as const;
export const AGENT_CREATION_APPROVER_ID = "konstantin" as const;

export const AgentCreationApplicantIdSchema = z.literal(AGENT_CREATION_APPLICANT_ID);
export const AgentCreationApproverIdSchema = z.literal(AGENT_CREATION_APPROVER_ID);

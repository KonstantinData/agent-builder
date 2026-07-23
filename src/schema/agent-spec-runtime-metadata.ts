import { z } from "zod";
import { SpecIdSchema } from "./common.js";
import {
  Rfc3339WithOffsetSchema,
  RuntimeBindingTtlSecondsSchema,
} from "./runtime-binding-validity.js";

/**
 * Section 4 of the architecture doc: schema validation, policy lint, and
 * evaluation are audit records inside `in_review`, not separate top-level
 * states — keeping this enum small avoids state-machine explosion.
 */
export const LifecycleStateSchema = z.enum([
  "draft",
  "in_review",
  "approved",
  "deployed",
  "suspended",
  "revoked",
  "rejected",
]);
export type LifecycleState = z.infer<typeof LifecycleStateSchema>;

export const StateHistoryEntrySchema = z
  .object({
    state: LifecycleStateSchema,
    actor: z.string().min(1),
    timestamp: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict();
export type StateHistoryEntry = z.infer<typeof StateHistoryEntrySchema>;

export const DeploymentBindingSchema = z
  .object({
    bindingId: z.string().min(1),
    contentHash: z.string().min(1),
    runtimeInstanceId: z.string().min(1),
    deployedAt: Rfc3339WithOffsetSchema,
    ttl: RuntimeBindingTtlSecondsSchema,
    lastHeartbeat: z.string().optional(),
  })
  .strict();
export type DeploymentBinding = z.infer<typeof DeploymentBindingSchema>;

/**
 * Mutable operational metadata (Section 3). Deliberately has no structural
 * relationship (no `Omit`/`Extend`) to `AgentSpecContent` — the two only ever
 * reference each other via the loose `specId`/`version` foreign keys.
 */
export const AgentSpecRuntimeMetadataSchema = z
  .object({
    specId: SpecIdSchema,
    version: z.string().min(1),
    state: LifecycleStateSchema,
    stateHistory: z.array(StateHistoryEntrySchema),
    requestor: z.string().min(1),
    deploymentBinding: DeploymentBindingSchema.optional(),
    ttl: z.number().positive().optional(),
    lastHeartbeat: z.string().optional(),
    suspendedReason: z.string().optional(),
    revokedReason: z.string().optional(),
    supersededBy: z.string().optional(),
  })
  .strict();
export type AgentSpecRuntimeMetadata = z.infer<typeof AgentSpecRuntimeMetadataSchema>;

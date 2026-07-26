import { z } from "zod";
import { SpecIdSchema } from "./common.js";
import {
  Rfc3339WithOffsetSchema,
  RuntimeBindingTtlSecondsSchema,
} from "./runtime-binding-validity.js";
import { isImplementedLifecycleTransition } from "../invariants/lifecycle-transition.js";

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
    timestamp: Rfc3339WithOffsetSchema,
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
  .strict()
  .superRefine((metadata, ctx) => {
    const first = metadata.stateHistory[0];
    const last = metadata.stateHistory.at(-1);
    if (first === undefined || first.state !== "draft") {
      ctx.addIssue({ code: "custom", path: ["stateHistory"], message: "history must begin at draft" });
    }
    if (last === undefined || last.state !== metadata.state) {
      ctx.addIssue({ code: "custom", path: ["stateHistory"], message: "current state must equal history tail" });
    }
    for (let index = 1; index < metadata.stateHistory.length; index += 1) {
      const previous = metadata.stateHistory[index - 1];
      const current = metadata.stateHistory[index];
      if (previous === undefined || current === undefined) continue;
      if (!isImplementedLifecycleTransition(previous.state, current.state)) {
        ctx.addIssue({ code: "custom", path: ["stateHistory", index, "state"], message: "lifecycle transition is not implemented" });
      }
      if (Date.parse(current.timestamp) <= Date.parse(previous.timestamp)) {
        ctx.addIssue({ code: "custom", path: ["stateHistory", index, "timestamp"], message: "history timestamps must increase" });
      }
    }
  });
export type AgentSpecRuntimeMetadata = z.infer<typeof AgentSpecRuntimeMetadataSchema>;

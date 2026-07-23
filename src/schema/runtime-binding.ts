import { z } from "zod";
import { AgentSpecContentSchema, type AgentSpecContent } from "./agent-spec-content.js";
import {
  AgentSpecRuntimeMetadataSchema,
  type AgentSpecRuntimeMetadata,
} from "./agent-spec-runtime-metadata.js";
import { ApprovalArtifactSchema, type ApprovalArtifact } from "./approval-artifact.js";
import { SpecIdSchema } from "./common.js";
import {
  Rfc3339WithOffsetSchema,
  RuntimeBindingTtlSecondsSchema,
} from "./runtime-binding-validity.js";

export const RuntimeBindingArtifactSchema = z
  .object({
    bindingId: z.string().min(1),
    specId: SpecIdSchema,
    version: z.string().min(1),
    contentHash: z.string().min(1),
    approvalArtifactId: z.string().min(1),
    runtimeInstanceId: z.string().min(1),
    deployedAt: Rfc3339WithOffsetSchema,
    ttl: RuntimeBindingTtlSecondsSchema,
  })
  .strict();
export type RuntimeBindingArtifact = z.infer<typeof RuntimeBindingArtifactSchema>;

export const RuntimeBindingInputSchema = z
  .object({
    spec: AgentSpecContentSchema,
    metadata: AgentSpecRuntimeMetadataSchema,
    approval: ApprovalArtifactSchema,
  })
  .strict();

export interface RuntimeBindingInput {
  readonly spec: AgentSpecContent;
  readonly metadata: AgentSpecRuntimeMetadata;
  readonly approval: ApprovalArtifact;
}

export const _runtimeBindingInputTypeBinding =
  RuntimeBindingInputSchema satisfies z.ZodType<RuntimeBindingInput>;

/**
 * Control-plane asserted runtime binding context. This boundary still emits an
 * unsigned RuntimeBindingArtifact; an external Control Plane signer creates the
 * attestation envelope verified by the Runtime Authorization Harness.
 */
export const TrustedRuntimeBindingContextSchema = z
  .object({
    bindingId: z.string().min(1),
    runtimeInstanceId: z.string().min(1),
    deployedAt: Rfc3339WithOffsetSchema,
    ttl: RuntimeBindingTtlSecondsSchema,
    actor: z.string().min(1),
    reason: z.string().min(1).optional(),
  })
  .strict();
export type TrustedRuntimeBindingContext = z.infer<typeof TrustedRuntimeBindingContextSchema>;

export const RUNTIME_BINDING_BLOCK_REASONS = [
  "input_invalid",
  "runtime_binding_state_not_deployable",
  "runtime_binding_subject_mismatch",
  "runtime_binding_approval_invalid",
  "runtime_binding_approval_subject_mismatch",
  "runtime_binding_already_exists",
  "runtime_binding_context_invalid",
] as const;
export const RuntimeBindingBlockReasonCodeSchema = z.enum(RUNTIME_BINDING_BLOCK_REASONS);
export type RuntimeBindingBlockReasonCode = z.infer<typeof RuntimeBindingBlockReasonCodeSchema>;

export type RuntimeBindingBlockReason =
  | { readonly type: "input_invalid"; readonly reason: string }
  | { readonly type: "runtime_binding_state_not_deployable"; readonly state: string }
  | { readonly type: "runtime_binding_subject_mismatch"; readonly specId: string; readonly version: string }
  | { readonly type: "runtime_binding_approval_invalid"; readonly reason: string }
  | { readonly type: "runtime_binding_approval_subject_mismatch"; readonly specId: string; readonly version: string }
  | { readonly type: "runtime_binding_already_exists"; readonly bindingId: string }
  | { readonly type: "runtime_binding_context_invalid"; readonly reason: string };

/**
 * Compile-time guard that keeps the closed block-reason catalog and structured
 * reason union in exact sync.
 */
type _blockReasonsInSync =
  [RuntimeBindingBlockReason["type"]] extends [RuntimeBindingBlockReasonCode]
    ? [RuntimeBindingBlockReasonCode] extends [RuntimeBindingBlockReason["type"]]
      ? true
      : never
    : never;
const _assertBlockReasonsInSync: _blockReasonsInSync = true;
void _assertBlockReasonsInSync;

export type RuntimeBindingResult =
  | {
      readonly outcome: "deployed";
      readonly binding: RuntimeBindingArtifact;
      readonly metadata: AgentSpecRuntimeMetadata;
    }
  | { readonly outcome: "blocked"; readonly reason: RuntimeBindingBlockReason };


import { z } from "zod";
import {
  AgentCallIntentSchema,
  NoWildcardStringSchema,
  SpecIdSchema,
  ToolIdSchema,
  type SpecId,
} from "./common.js";
import { AgentSpecContentSchema, type AgentSpecContent } from "./agent-spec-content.js";
import {
  AgentSpecRuntimeMetadataSchema,
  type AgentSpecRuntimeMetadata,
  LifecycleStateSchema,
  type LifecycleState,
} from "./agent-spec-runtime-metadata.js";
import { ApprovalArtifactSchema, type ApprovalArtifact } from "./approval-artifact.js";
import { CallContextSchema, type CallContext } from "./call-context.js";
import { Rfc3339WithOffsetSchema } from "./runtime-binding-validity.js";

/**
 * Runtime budget dimensions are intentionally separate from spec `Budget`.
 * Spec budgets model approved content limits (cost/iterations/timeout); runtime
 * call contexts model spend-down limits (calls/tokens/time). Mixing them would
 * compare unrelated axes and create a false monotonicity proof.
 */
export const RuntimeBudgetSchema = z
  .object({
    callBudget: z.number().int().nonnegative(),
    tokenBudget: z.number().int().nonnegative(),
    timeBudget: z.number().nonnegative(),
  })
  .strict();
export type RuntimeBudget = z.infer<typeof RuntimeBudgetSchema>;

export const ToolCallRuntimeActionSchema = z
  .object({
    type: z.literal("tool_call"),
    toolId: ToolIdSchema,
    scope: NoWildcardStringSchema,
  })
  .strict();

export const AgentCallRuntimeActionSchema = z
  .object({
    type: z.literal("agent_call"),
    calleeSpecId: SpecIdSchema,
    calleeVersionOrChannel: z.string().min(1),
    intent: AgentCallIntentSchema,
    childBudget: RuntimeBudgetSchema,
  })
  .strict();

export const RuntimeActionSchema = z.discriminatedUnion("type", [
  ToolCallRuntimeActionSchema,
  AgentCallRuntimeActionSchema,
]);
export type RuntimeAction = z.infer<typeof RuntimeActionSchema>;
export type ToolCallRuntimeAction = z.infer<typeof ToolCallRuntimeActionSchema>;
export type AgentCallRuntimeAction = z.infer<typeof AgentCallRuntimeActionSchema>;

export interface CalleeLifecycleEvidence {
  readonly calleeSpecId: SpecId;
  readonly calleeVersionOrChannel: string;
  readonly state: LifecycleState;
}

export const CalleeLifecycleEvidenceSchema = z
  .object({
    calleeSpecId: SpecIdSchema,
    calleeVersionOrChannel: z.string().min(1),
    state: LifecycleStateSchema,
  })
  .strict();
export const _calleeLifecycleEvidenceTypeBinding =
  CalleeLifecycleEvidenceSchema satisfies z.ZodType<CalleeLifecycleEvidence>;

export const RuntimeAuthorizationInputSchema = z
  .object({
    spec: AgentSpecContentSchema,
    metadata: AgentSpecRuntimeMetadataSchema,
    action: RuntimeActionSchema,
    callContext: CallContextSchema,
    currentRunId: z.string().min(1),
    edgeApprovals: z.array(ApprovalArtifactSchema),
    calleeLifecycleEvidence: CalleeLifecycleEvidenceSchema.optional(),
  })
  .strict();

export interface RuntimeAuthorizationInput {
  readonly spec: AgentSpecContent;
  readonly metadata: AgentSpecRuntimeMetadata;
  readonly action: RuntimeAction;
  readonly callContext: CallContext;
  readonly currentRunId: string;
  readonly edgeApprovals: ReadonlyArray<ApprovalArtifact>;
  readonly calleeLifecycleEvidence?: CalleeLifecycleEvidence | undefined;
}

export const _runtimeAuthorizationInputTypeBinding =
  RuntimeAuthorizationInputSchema satisfies z.ZodType<RuntimeAuthorizationInput>;

/**
 * Data-plane asserted decision context. It is separate from caller-supplied
 * authorization input so the decision instant has an explicit provenance
 * boundary and can be injected deterministically without a wall-clock fallback.
 */
export interface TrustedRuntimeAuthorizationContext {
  readonly authorizationTime: string;
}

export const TrustedRuntimeAuthorizationContextSchema = z
  .object({
    authorizationTime: Rfc3339WithOffsetSchema,
  })
  .strict();
export const _trustedRuntimeAuthorizationContextTypeBinding =
  TrustedRuntimeAuthorizationContextSchema satisfies z.ZodType<TrustedRuntimeAuthorizationContext>;

export const RUNTIME_AUTHORIZATION_BLOCK_REASONS = [
  "input_invalid",
  "runtime_state_not_executable",
  "runtime_subject_mismatch",
  "runtime_binding_missing",
  "runtime_binding_content_hash_mismatch",
  "runtime_authorization_context_invalid",
  "runtime_binding_not_yet_valid",
  "runtime_binding_expired",
  "call_context_invalid",
  "tool_not_declared",
  "tool_scope_not_allowed",
  "agent_call_not_declared",
  "call_edge_not_approved",
  "ambiguous_call_edge_approval",
  "call_intent_not_allowed",
  "human_gate_required",
  "cycle_detected",
  "callee_lifecycle_evidence_missing",
  "callee_lifecycle_subject_mismatch",
  "callee_state_not_callable",
  "depth_exhausted",
  "call_budget_exhausted",
  "budget_increase_forbidden",
] as const;
export const RuntimeAuthorizationBlockReasonCodeSchema = z.enum(
  RUNTIME_AUTHORIZATION_BLOCK_REASONS,
);
export type RuntimeAuthorizationBlockReasonCode = z.infer<
  typeof RuntimeAuthorizationBlockReasonCodeSchema
>;

export type RuntimeAuthorizationBlockReason =
  | { readonly type: "input_invalid"; readonly reason: string }
  | { readonly type: "runtime_state_not_executable"; readonly state: string }
  | { readonly type: "runtime_subject_mismatch"; readonly specId: string; readonly version: string }
  | { readonly type: "runtime_binding_missing"; readonly specId: string; readonly version: string }
  | { readonly type: "runtime_binding_content_hash_mismatch"; readonly specId: string; readonly version: string }
  | { readonly type: "runtime_authorization_context_invalid"; readonly reason: string }
  | { readonly type: "runtime_binding_not_yet_valid"; readonly bindingId: string }
  | { readonly type: "runtime_binding_expired"; readonly bindingId: string }
  | { readonly type: "call_context_invalid"; readonly reason: string }
  | { readonly type: "tool_not_declared"; readonly toolId: string }
  | { readonly type: "tool_scope_not_allowed"; readonly toolId: string; readonly scope: string }
  | { readonly type: "agent_call_not_declared"; readonly calleeSpecId: string; readonly calleeVersionOrChannel: string }
  | { readonly type: "call_edge_not_approved"; readonly calleeSpecId: string; readonly calleeVersionOrChannel: string }
  | { readonly type: "ambiguous_call_edge_approval"; readonly calleeSpecId: string; readonly calleeVersionOrChannel: string }
  | { readonly type: "call_intent_not_allowed"; readonly intent: string }
  | { readonly type: "human_gate_required"; readonly calleeSpecId: string; readonly calleeVersionOrChannel: string }
  | { readonly type: "cycle_detected"; readonly calleeSpecId: string }
  | { readonly type: "callee_lifecycle_evidence_missing"; readonly calleeSpecId: string; readonly calleeVersionOrChannel: string }
  | { readonly type: "callee_lifecycle_subject_mismatch"; readonly calleeSpecId: string; readonly calleeVersionOrChannel: string }
  | { readonly type: "callee_state_not_callable"; readonly calleeSpecId: string; readonly calleeVersionOrChannel: string; readonly state: string }
  | { readonly type: "depth_exhausted" }
  | { readonly type: "call_budget_exhausted" }
  | { readonly type: "budget_increase_forbidden"; readonly budget: RuntimeBudget };

/**
 * Compile-time guard that the closed block-reason catalog and the structured
 * reason union stay in exact sync. Adding a code in one place without the other
 * breaks typecheck instead of letting runtime audit codes drift silently.
 */
type _blockReasonsInSync =
  [RuntimeAuthorizationBlockReason["type"]] extends [RuntimeAuthorizationBlockReasonCode]
    ? [RuntimeAuthorizationBlockReasonCode] extends [RuntimeAuthorizationBlockReason["type"]]
      ? true
      : never
    : never;
const _assertBlockReasonsInSync: _blockReasonsInSync = true;
void _assertBlockReasonsInSync;

export type RuntimeAuthorizationResult =
  | { readonly outcome: "allowed"; readonly actionType: "tool_call" }
  | {
      readonly outcome: "allowed";
      readonly actionType: "agent_call";
      readonly nextCallContext: CallContext;
    }
  | { readonly outcome: "blocked"; readonly reason: RuntimeAuthorizationBlockReason };

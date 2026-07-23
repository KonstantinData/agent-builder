import type {
  AgentSpecRuntimeMetadata,
  DeploymentBinding,
  StateHistoryEntry,
} from "../schema/agent-spec-runtime-metadata.js";
import type { ApprovalArtifact } from "../schema/approval-artifact.js";
import type {
  RuntimeBindingArtifact,
  RuntimeBindingInput,
  RuntimeBindingResult,
  TrustedRuntimeBindingContext,
} from "../schema/runtime-binding.js";
import {
  RuntimeBindingInputSchema,
  RuntimeBindingArtifactSchema,
  TrustedRuntimeBindingContextSchema,
} from "../schema/runtime-binding.js";

const DEPLOYABLE_STATE = "approved";

function buildRuntimeBindingArtifact(
  input: RuntimeBindingInput,
  ctx: TrustedRuntimeBindingContext,
): RuntimeBindingArtifact {
  return RuntimeBindingArtifactSchema.parse({
    bindingId: ctx.bindingId,
    specId: input.spec.specId,
    version: input.spec.version,
    contentHash: input.spec.contentHash,
    approvalArtifactId: input.approval.artifactId,
    runtimeInstanceId: ctx.runtimeInstanceId,
    deployedAt: ctx.deployedAt,
    ttl: ctx.ttl,
  });
}

function buildDeploymentBinding(
  artifact: RuntimeBindingArtifact,
): DeploymentBinding {
  return {
    bindingId: artifact.bindingId,
    contentHash: artifact.contentHash,
    runtimeInstanceId: artifact.runtimeInstanceId,
    deployedAt: artifact.deployedAt,
    ttl: artifact.ttl,
  };
}

function withDeployedTransition(
  metadata: AgentSpecRuntimeMetadata,
  binding: DeploymentBinding,
  ctx: TrustedRuntimeBindingContext,
): AgentSpecRuntimeMetadata {
  const entry: StateHistoryEntry = {
    state: "deployed",
    actor: ctx.actor,
    timestamp: ctx.deployedAt,
    reason: ctx.reason ?? `runtime binding created (${binding.bindingId})`,
  };
  return {
    ...metadata,
    state: "deployed",
    deploymentBinding: binding,
    stateHistory: [...metadata.stateHistory, entry],
  };
}

type AgentSpecApprovalArtifact = Extract<ApprovalArtifact, { readonly type: "agent_spec" }>;

function approvalIsDeployable(approval: ApprovalArtifact): approval is AgentSpecApprovalArtifact {
  return approval.type === "agent_spec" && approval.decision === "approved";
}

/**
 * Runtime Binding / Deployment Executor Boundary v0.1. Pure function: consumes
 * an already-approved spec approval and produces immutable binding evidence
 * plus mutable runtime metadata transition. It never starts infrastructure,
 * touches a registry/DB, executes tools, or performs runtime health checks.
 */
export function createRuntimeBinding(
  input: RuntimeBindingInput,
  ctx: TrustedRuntimeBindingContext,
): RuntimeBindingResult {
  const parsedInput = RuntimeBindingInputSchema.safeParse(input);
  if (!parsedInput.success) {
    return { outcome: "blocked", reason: { type: "input_invalid", reason: "schema_validation_failed" } };
  }
  const validatedInput = parsedInput.data;

  const parsedContext = TrustedRuntimeBindingContextSchema.safeParse(ctx);
  if (!parsedContext.success) {
    return {
      outcome: "blocked",
      reason: { type: "runtime_binding_context_invalid", reason: "schema_validation_failed" },
    };
  }
  const validatedContext = parsedContext.data;

  if (validatedInput.metadata.state !== DEPLOYABLE_STATE) {
    return {
      outcome: "blocked",
      reason: {
        type: "runtime_binding_state_not_deployable",
        state: validatedInput.metadata.state,
      },
    };
  }

  if (
    validatedInput.metadata.specId !== validatedInput.spec.specId ||
    validatedInput.metadata.version !== validatedInput.spec.version
  ) {
    return {
      outcome: "blocked",
      reason: {
        type: "runtime_binding_subject_mismatch",
        specId: validatedInput.spec.specId,
        version: validatedInput.spec.version,
      },
    };
  }

  if (!approvalIsDeployable(validatedInput.approval)) {
    return {
      outcome: "blocked",
      reason: { type: "runtime_binding_approval_invalid", reason: "approval_not_approved_agent_spec" },
    };
  }

  if (validatedInput.approval.decidedBy === undefined || validatedInput.approval.decidedAt === undefined) {
    return {
      outcome: "blocked",
      reason: { type: "runtime_binding_approval_invalid", reason: "approval_decision_metadata_missing" },
    };
  }

  if (
    validatedInput.approval.specId !== validatedInput.spec.specId ||
    validatedInput.approval.version !== validatedInput.spec.version ||
    validatedInput.approval.contentHash !== validatedInput.spec.contentHash
  ) {
    return {
      outcome: "blocked",
      reason: {
        type: "runtime_binding_approval_subject_mismatch",
        specId: validatedInput.spec.specId,
        version: validatedInput.spec.version,
      },
    };
  }

  if (validatedInput.metadata.deploymentBinding !== undefined) {
    return {
      outcome: "blocked",
      reason: {
        type: "runtime_binding_already_exists",
        bindingId: validatedInput.metadata.deploymentBinding.bindingId,
      },
    };
  }

  const binding = buildRuntimeBindingArtifact(validatedInput, validatedContext);
  return {
    outcome: "deployed",
    binding,
    metadata: withDeployedTransition(
      validatedInput.metadata,
      buildDeploymentBinding(binding),
      validatedContext,
    ),
  };
}

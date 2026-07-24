import {
  MODEL_ROUTING_POLICY_V1,
  ModelRouteTriggerSchema,
  ModelRoutingDecisionV1Schema,
  type ModelId,
  type ModelRouteTrigger,
  type ModelRoutingDecisionV1,
  type ModelRoutingPolicyV1,
} from "./contracts.js";

export interface ModelRoutingInput {
  readonly atTaskBoundary: boolean;
  readonly currentModel?: ModelId;
  readonly securityContract: boolean;
  readonly majorArchitectureDecision: boolean;
  readonly claudeContractConflict: boolean;
  readonly unsuccessfulAttemptsInPhase: number;
  readonly contextComplexityUnits: number;
  readonly availableModels: readonly ModelId[];
  readonly allowDegradedFallback: boolean;
  readonly attemptLimit: number;
  readonly observableBudget: ModelRoutingDecisionV1["observableBudget"];
}

export type ModelRoutingResult =
  | { readonly kind: "selected"; readonly decision: ModelRoutingDecisionV1 }
  | { readonly kind: "stopped"; readonly reason: "model_route_unavailable" | "model_route_policy_violation" };

function collectTriggers(input: ModelRoutingInput, policy: ModelRoutingPolicyV1): ModelRouteTrigger[] {
  const triggers: ModelRouteTrigger[] = [];
  if (input.securityContract) triggers.push("security_contract");
  if (input.majorArchitectureDecision) triggers.push("major_architecture_decision");
  if (input.claudeContractConflict) triggers.push("claude_contract_conflict");
  if (input.unsuccessfulAttemptsInPhase >= policy.repeatedFailureThreshold) {
    triggers.push("repeated_solution_failure");
  }
  if (input.contextComplexityUnits >= policy.highContextComplexityThreshold) {
    triggers.push("high_context_complexity");
  }
  return ModelRouteTriggerSchema.array().parse(triggers);
}

function triggerEvidence(input: ModelRoutingInput, policy: ModelRoutingPolicyV1): ModelRoutingDecisionV1["triggerEvidence"] {
  return {
    securityContract: input.securityContract,
    majorArchitectureDecision: input.majorArchitectureDecision,
    claudeContractConflict: input.claudeContractConflict,
    unsuccessfulAttemptsInPhase: input.unsuccessfulAttemptsInPhase,
    contextComplexityUnits: input.contextComplexityUnits,
    highContextComplexityThreshold: policy.highContextComplexityThreshold,
  };
}

export function validateModelRoutingDecision(
  decisionInput: ModelRoutingDecisionV1,
  allowDegradedFallback: boolean,
  policy: ModelRoutingPolicyV1 = MODEL_ROUTING_POLICY_V1,
): boolean {
  const parsed = ModelRoutingDecisionV1Schema.safeParse(decisionInput);
  if (!parsed.success) return false;
  const decision = parsed.data;
  const expectedTriggers = collectTriggers({
    atTaskBoundary: decision.status !== "deferred_to_next_task_start",
    currentModel: decision.selectedModel,
    securityContract: decision.triggerEvidence.securityContract,
    majorArchitectureDecision: decision.triggerEvidence.majorArchitectureDecision,
    claudeContractConflict: decision.triggerEvidence.claudeContractConflict,
    unsuccessfulAttemptsInPhase: decision.triggerEvidence.unsuccessfulAttemptsInPhase,
    contextComplexityUnits: decision.triggerEvidence.contextComplexityUnits,
    availableModels: [decision.selectedModel],
    allowDegradedFallback,
    attemptLimit: decision.attemptLimit,
    observableBudget: decision.observableBudget,
  }, policy);
  if (decision.triggerEvidence.highContextComplexityThreshold !== policy.highContextComplexityThreshold) return false;
  if (expectedTriggers.length !== decision.triggers.length || expectedTriggers.some((trigger, index) => trigger !== decision.triggers[index])) return false;
  const expectsSol = decision.triggers.length > 0;
  if (decision.requestedModel !== (expectsSol ? policy.escalationModel : policy.defaultModel)) return false;
  if (decision.requestedReasoningEffort !== (expectsSol ? policy.escalationReasoningEffort : policy.defaultReasoningEffort)) return false;
  if (decision.selectedModel === policy.defaultModel && decision.reasoningEffort !== policy.defaultReasoningEffort) return false;
  if (decision.selectedModel === policy.escalationModel && decision.reasoningEffort !== policy.escalationReasoningEffort) return false;
  if (decision.status === "applied") return decision.selectedModel === decision.requestedModel && decision.fallbackDecision === "none";
  if (decision.status === "deferred_to_next_task_start") return decision.selectedModel !== decision.requestedModel && decision.fallbackDecision === "stop_if_unavailable";
  return allowDegradedFallback && decision.requestedModel === policy.escalationModel && decision.selectedModel === policy.defaultModel && decision.fallbackDecision === "authorized_degraded";
}

export function selectModelRoute(
  input: ModelRoutingInput,
  policy: ModelRoutingPolicyV1 = MODEL_ROUTING_POLICY_V1,
): ModelRoutingResult {
  const triggers = collectTriggers(input, policy);
  const requestedModel: ModelId = triggers.length > 0 ? policy.escalationModel : policy.defaultModel;
  const requestedEffort = triggers.length > 0 ? policy.escalationReasoningEffort : policy.defaultReasoningEffort;

  if (!input.atTaskBoundary && input.currentModel === undefined) {
    return { kind: "stopped", reason: "model_route_policy_violation" };
  }

  if (!input.atTaskBoundary && input.currentModel !== undefined && input.currentModel !== requestedModel) {
    return {
      kind: "selected",
      decision: ModelRoutingDecisionV1Schema.parse({
        routingPolicyVersion: policy.schemaVersion,
        requestedModel,
        requestedReasoningEffort: requestedEffort,
        selectedModel: input.currentModel,
        reasoningEffort: input.currentModel === "gpt-5.6-sol" ? policy.escalationReasoningEffort : policy.defaultReasoningEffort,
        triggers,
        triggerEvidence: triggerEvidence(input, policy),
        justification: `Requested ${requestedModel} is deferred until the next task or step boundary.`,
        status: "deferred_to_next_task_start",
        attemptLimit: input.attemptLimit,
        observableBudget: input.observableBudget,
        fallbackDecision: "stop_if_unavailable",
      }),
    };
  }

  if (input.availableModels.includes(requestedModel)) {
    return {
      kind: "selected",
      decision: ModelRoutingDecisionV1Schema.parse({
        routingPolicyVersion: policy.schemaVersion,
        requestedModel,
        requestedReasoningEffort: requestedEffort,
        selectedModel: requestedModel,
        reasoningEffort: requestedEffort,
        triggers,
        triggerEvidence: triggerEvidence(input, policy),
        justification: triggers.length === 0
          ? "Default route for a new task or step boundary."
          : `Escalated at a task or step boundary for: ${triggers.join(", ")}.`,
        status: "applied",
        attemptLimit: input.attemptLimit,
        observableBudget: input.observableBudget,
        fallbackDecision: "none",
      }),
    };
  }

  if (requestedModel === policy.escalationModel && input.allowDegradedFallback && input.availableModels.includes(policy.defaultModel)) {
    return {
      kind: "selected",
      decision: ModelRoutingDecisionV1Schema.parse({
        routingPolicyVersion: policy.schemaVersion,
        requestedModel,
        requestedReasoningEffort: requestedEffort,
        selectedModel: policy.defaultModel,
        reasoningEffort: policy.defaultReasoningEffort,
        triggers,
        triggerEvidence: triggerEvidence(input, policy),
        justification: "The escalation route is unavailable; the externally authorized degraded route is applied.",
        status: "fallback_applied",
        attemptLimit: input.attemptLimit,
        observableBudget: input.observableBudget,
        fallbackDecision: "authorized_degraded",
      }),
    };
  }

  return { kind: "stopped", reason: "model_route_unavailable" };
}

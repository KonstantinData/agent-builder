import { describe, expect, it } from "vitest";
import { canonicalJson, domainSeparatedDigest } from "../../src/orchestration/canonical-json.js";
import { selectModelRoute } from "../../src/orchestration/model-routing.js";
import { EnvironmentAttestationV1Schema } from "../../src/orchestration/contracts.js";

function routingInput(overrides: Partial<Parameters<typeof selectModelRoute>[0]> = {}): Parameters<typeof selectModelRoute>[0] {
  return {
    atTaskBoundary: true,
    securityContract: false,
    majorArchitectureDecision: false,
    claudeContractConflict: false,
    unsuccessfulAttemptsInPhase: 0,
    contextComplexityUnits: 10_000,
    availableModels: ["gpt-5.6-terra", "gpt-5.6-sol"],
    allowDegradedFallback: false,
    attemptLimit: 2,
    observableBudget: { unit: "turns", limit: 4 },
    ...overrides,
  };
}

describe("orchestration canonical JSON", () => {
  it("sorts keys recursively, preserves array order, and normalizes Unicode", () => {
    expect(canonicalJson({ z: [{ b: "e\u0301", a: 1 }], a: true })).toBe(
      '{"a":true,"z":[{"a":1,"b":"é"}]}',
    );
  });

  it("uses domain separation and rejects non-integer numbers", () => {
    expect(domainSeparatedDigest("a", { value: 1 })).not.toBe(domainSeparatedDigest("b", { value: 1 }));
    expect(() => canonicalJson({ value: 1.5 })).toThrow("safe integers");
  });
});

describe("model routing policy v1", () => {
  it("defaults new step starts to Terra with medium reasoning", () => {
    const result = selectModelRoute(routingInput());
    expect(result).toMatchObject({
      kind: "selected",
      decision: { selectedModel: "gpt-5.6-terra", reasoningEffort: "medium", status: "applied", triggers: [] },
    });
  });

  it.each([
    ["security", { securityContract: true }, "security_contract"],
    ["architecture", { majorArchitectureDecision: true }, "major_architecture_decision"],
    ["Claude conflict", { claudeContractConflict: true }, "claude_contract_conflict"],
    ["repeated failure", { unsuccessfulAttemptsInPhase: 2 }, "repeated_solution_failure"],
    ["high context", { contextComplexityUnits: 100_000 }, "high_context_complexity"],
  ])("routes %s to Sol with an auditable trigger", (_label, override, trigger) => {
    const result = selectModelRoute(routingInput(override));
    expect(result).toMatchObject({
      kind: "selected",
      decision: { requestedModel: "gpt-5.6-sol", selectedModel: "gpt-5.6-sol", triggers: [trigger] },
    });
  });

  it("records a mid-task escalation as deferred instead of claiming a switch", () => {
    const result = selectModelRoute(routingInput({
      atTaskBoundary: false,
      currentModel: "gpt-5.6-terra",
      securityContract: true,
    }));
    expect(result).toMatchObject({
      kind: "selected",
      decision: {
        requestedModel: "gpt-5.6-sol",
        selectedModel: "gpt-5.6-terra",
        status: "deferred_to_next_task_start",
        fallbackDecision: "stop_if_unavailable",
      },
    });
  });

  it("fails closed when a mid-task caller omits the current model", () => {
    expect(selectModelRoute(routingInput({ atTaskBoundary: false, securityContract: true }))).toEqual({
      kind: "stopped",
      reason: "model_route_policy_violation",
    });
  });

  it("fails closed when the selected route is unavailable unless degraded fallback is authorized", () => {
    expect(selectModelRoute(routingInput({ securityContract: true, availableModels: ["gpt-5.6-terra"] }))).toEqual({
      kind: "stopped",
      reason: "model_route_unavailable",
    });
    expect(selectModelRoute(routingInput({
      securityContract: true,
      availableModels: ["gpt-5.6-terra"],
      allowDegradedFallback: true,
    }))).toMatchObject({
      kind: "selected",
      decision: { selectedModel: "gpt-5.6-terra", status: "fallback_applied", fallbackDecision: "authorized_degraded" },
    });
  });
});

describe("attended-local environment boundary", () => {
  it("accepts only an explicit attended non-CI environment", () => {
    expect(EnvironmentAttestationV1Schema.safeParse({
      schemaVersion: "orchestration-environment/1",
      executionMode: "attended_local",
      ci: false,
      nonInteractive: false,
      observedAt: "2026-07-24T10:00:00Z",
    }).success).toBe(true);
    expect(EnvironmentAttestationV1Schema.safeParse({
      schemaVersion: "orchestration-environment/1",
      executionMode: "attended_local",
      ci: true,
      nonInteractive: true,
      observedAt: "2026-07-24T10:00:00Z",
    }).success).toBe(false);
  });
});

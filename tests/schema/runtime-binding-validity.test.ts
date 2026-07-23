import { describe, expect, it } from "vitest";
import {
  MAX_RUNTIME_BINDING_TTL_SECONDS,
  Rfc3339WithOffsetSchema,
  RuntimeBindingTtlSecondsSchema,
} from "../../src/schema/runtime-binding-validity.js";
import { DeploymentBindingSchema } from "../../src/schema/agent-spec-runtime-metadata.js";
import {
  RuntimeBindingArtifactSchema,
  TrustedRuntimeBindingContextSchema,
} from "../../src/schema/runtime-binding.js";

describe("Runtime binding validity schemas", () => {
  it("accepts Z and explicit-offset RFC 3339 instants", () => {
    expect(Rfc3339WithOffsetSchema.safeParse("2026-07-23T12:00:00Z").success).toBe(true);
    expect(Rfc3339WithOffsetSchema.safeParse("2026-07-23T14:00:00+02:00").success).toBe(true);
  });

  it.each([
    "2026-07-23T12:00:00",
    "2026-07-23",
    "2026-02-30T12:00:00Z",
    "2026-07-23T12:00:00+0200",
    "2026-07-23T12:00:60Z",
    "2026-07-23T12:00:00.0001Z",
    "not-a-timestamp",
  ])("rejects ambiguous or invalid timestamp `%s`", (timestamp) => {
    expect(Rfc3339WithOffsetSchema.safeParse(timestamp).success).toBe(false);
  });

  it("accepts positive whole-second TTLs through the hard ceiling", () => {
    expect(RuntimeBindingTtlSecondsSchema.safeParse(1).success).toBe(true);
    expect(
      RuntimeBindingTtlSecondsSchema.safeParse(MAX_RUNTIME_BINDING_TTL_SECONDS).success,
    ).toBe(true);
  });

  it.each([
    0,
    -1,
    0.5,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NaN,
    MAX_RUNTIME_BINDING_TTL_SECONDS + 1,
    1e300,
  ])("rejects unsafe runtime binding TTL `%s`", (ttl) => {
    expect(RuntimeBindingTtlSecondsSchema.safeParse(ttl).success).toBe(false);
  });

  it("wires hardened timestamps and TTLs through every runtime binding schema", () => {
    const deploymentBinding = {
      bindingId: "binding-crm-enricher-001",
      contentHash: "hash-v1",
      runtimeInstanceId: "runtime-crm-enricher-001",
      deployedAt: "2026-07-23T12:30:00Z",
      ttl: 3600,
    };
    const artifact = {
      ...deploymentBinding,
      specId: "spec-crm-enricher",
      version: "1.0.0",
      approvalArtifactId: "approval-crm-enricher-001",
    };
    const context = {
      bindingId: deploymentBinding.bindingId,
      runtimeInstanceId: deploymentBinding.runtimeInstanceId,
      deployedAt: deploymentBinding.deployedAt,
      ttl: deploymentBinding.ttl,
      actor: "deployment-executor",
    };

    expect(DeploymentBindingSchema.safeParse(deploymentBinding).success).toBe(true);
    expect(RuntimeBindingArtifactSchema.safeParse(artifact).success).toBe(true);
    expect(TrustedRuntimeBindingContextSchema.safeParse(context).success).toBe(true);

    for (const [schema, candidate] of [
      [DeploymentBindingSchema, deploymentBinding],
      [RuntimeBindingArtifactSchema, artifact],
      [TrustedRuntimeBindingContextSchema, context],
    ] as const) {
      expect(
        schema.safeParse({
          ...candidate,
          deployedAt: "2026-07-23T12:30:00.0001Z",
        }).success,
      ).toBe(false);
      expect(
        schema.safeParse({
          ...candidate,
          ttl: MAX_RUNTIME_BINDING_TTL_SECONDS + 1,
        }).success,
      ).toBe(false);
    }
  });
});

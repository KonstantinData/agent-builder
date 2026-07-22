import { describe, expect, it } from "vitest";
import { AgentSpecRuntimeMetadataSchema } from "../../src/schema/agent-spec-runtime-metadata.js";

const validMetadata = {
  specId: "spec-crm-enricher",
  version: "1.0.0",
  state: "in_review",
  stateHistory: [
    { state: "draft", actor: "builder-agent", timestamp: "2026-07-20T10:00:00Z", reason: "initial draft" },
    { state: "in_review", actor: "policy-harness", timestamp: "2026-07-20T10:05:00Z", reason: "schema validated" },
  ],
  requestor: "builder-agent",
};

describe("AgentSpecRuntimeMetadataSchema", () => {
  it("accepts valid mutable lifecycle metadata", () => {
    expect(AgentSpecRuntimeMetadataSchema.safeParse(validMetadata).success).toBe(true);
  });

  it("rejects a lifecycle state outside the fixed state machine", () => {
    const candidate = { ...validMetadata, state: "archived" };
    expect(AgentSpecRuntimeMetadataSchema.safeParse(candidate).success).toBe(false);
  });
});

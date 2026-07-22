import { describe, expect, it } from "vitest";
import { AgentCallPolicyEdgeSchema } from "../../src/schema/agent-call-policy-edge.js";
import { edgeAToB } from "../fixtures/specs.js";

describe("AgentCallPolicyEdgeSchema", () => {
  it("accepts a valid, resolved edge", () => {
    expect(AgentCallPolicyEdgeSchema.safeParse(edgeAToB).success).toBe(true);
  });

  it("rejects an intent outside the closed catalog", () => {
    const candidate = { ...edgeAToB, allowedIntents: ["anything_goes"] };
    expect(AgentCallPolicyEdgeSchema.safeParse(candidate).success).toBe(false);
  });

  it("rejects a wildcard data share scope", () => {
    const candidate = { ...edgeAToB, dataShareScope: "tenant:*" };
    expect(AgentCallPolicyEdgeSchema.safeParse(candidate).success).toBe(false);
  });
});

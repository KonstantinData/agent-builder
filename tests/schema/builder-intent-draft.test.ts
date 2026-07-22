import { describe, expect, it } from "vitest";
import { BuilderIntentDraftSchema } from "../../src/schema/builder-intent-draft.js";
import { validBuilderIntentDraftRaw } from "../fixtures/specs.js";

describe("BuilderIntentDraftSchema", () => {
  it("accepts a valid role-based request", () => {
    expect(BuilderIntentDraftSchema.safeParse(validBuilderIntentDraftRaw).success).toBe(true);
  });

  it("rejects a resolved calleeSpecId leaking into a draft request (Invariant 6)", () => {
    const candidate = {
      ...validBuilderIntentDraftRaw,
      requestedAgentCalls: [
        {
          calleeSpecId: "spec-web-search",
          allowedIntents: ["query"],
          maxDepth: 1,
          maxCallsPerRun: 3,
          rationale: "Should never carry a resolved id before the Deployment Gate.",
        },
      ],
    };
    expect(BuilderIntentDraftSchema.safeParse(candidate).success).toBe(false);
  });
});

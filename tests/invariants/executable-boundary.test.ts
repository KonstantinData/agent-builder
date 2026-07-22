import { describe, expect, it } from "vitest";
import { isBuilderIntentDraft, isExecutableSpec } from "../../src/invariants/executable-boundary.js";
import {
  contentSharingDraftIdRaw,
  validAgentSpecContentRaw,
  validBuilderIntentDraftRaw,
} from "../fixtures/specs.js";

describe("executable boundary (Invariants 1 + 6)", () => {
  it("recognizes a valid draft as a draft, never as executable content", () => {
    expect(isBuilderIntentDraft(validBuilderIntentDraftRaw)).toBe(true);
    expect(isExecutableSpec(validBuilderIntentDraftRaw)).toBe(false);
  });

  it("recognizes valid spec content as executable, never as a draft", () => {
    expect(isExecutableSpec(validAgentSpecContentRaw)).toBe(true);
    expect(isBuilderIntentDraft(validAgentSpecContentRaw)).toBe(false);
  });

  it("does not confuse the two kinds even when identifier text matches", () => {
    expect(isExecutableSpec(contentSharingDraftIdRaw)).toBe(true);
    expect(isBuilderIntentDraft(contentSharingDraftIdRaw)).toBe(false);
  });
});

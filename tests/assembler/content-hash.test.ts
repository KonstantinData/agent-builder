import { describe, expect, it } from "vitest";
import { canonicalize, computeContentHash } from "../../src/assembler/content-hash.js";
import { validAgentSpecContent } from "../fixtures/specs.js";

describe("canonicalize", () => {
  it("produces identical output regardless of object key insertion order", () => {
    const a = { one: 1, two: 2 };
    const b = { two: 2, one: 1 };
    expect(JSON.stringify(canonicalize(a))).toBe(JSON.stringify(canonicalize(b)));
  });

  it("preserves array order, including for objects nested in arrays", () => {
    const value = [{ b: 1, a: 2 }, { z: 9 }];
    const canonical = canonicalize(value) as unknown[];
    expect(canonical).toHaveLength(2);
    expect(JSON.stringify(canonical[0])).toBe(JSON.stringify({ a: 2, b: 1 }));
  });
});

describe("computeContentHash", () => {
  const { contentHash: _ignored, ...contentWithoutHash } = validAgentSpecContent;

  it("is deterministic for identical input", () => {
    expect(computeContentHash(contentWithoutHash)).toBe(computeContentHash(contentWithoutHash));
  });

  it("changes when a field changes", () => {
    const changed = { ...contentWithoutHash, objective: "A different objective entirely." };
    expect(computeContentHash(changed)).not.toBe(computeContentHash(contentWithoutHash));
  });

  it("is unaffected by top-level property insertion order", () => {
    const reordered = Object.fromEntries(
      Object.entries(contentWithoutHash).reverse(),
    ) as typeof contentWithoutHash;
    expect(computeContentHash(reordered)).toBe(computeContentHash(contentWithoutHash));
  });
});

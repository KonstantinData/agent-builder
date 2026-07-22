import { describe, expect, it } from "vitest";
import { detectCycleInChain, wouldCreateGraphCycle } from "../../src/invariants/cycle-detection.js";
import {
  acyclicCandidateEdge,
  cyclicCandidateEdge,
  linearEdges,
  specA,
  specB,
  specC,
} from "../fixtures/specs.js";

describe("detectCycleInChain (Invariant 4a — runtime call-chain check)", () => {
  it("allows calling a spec that is not yet in the chain", () => {
    expect(detectCycleInChain([specA, specB], specC)).toBe(false);
  });

  it("rejects calling a spec already present in the chain, regardless of edge maxDepth", () => {
    expect(detectCycleInChain([specA, specB], specA)).toBe(true);
  });
});

describe("wouldCreateGraphCycle (Invariant 4b — edge-approval check)", () => {
  it("allows an edge that does not close a cycle", () => {
    expect(wouldCreateGraphCycle(linearEdges, acyclicCandidateEdge)).toBe(false);
  });

  it("rejects an edge that would close a cycle across the existing graph", () => {
    expect(wouldCreateGraphCycle(linearEdges, cyclicCandidateEdge)).toBe(true);
  });

  it("rejects a self-edge", () => {
    expect(wouldCreateGraphCycle([], { callerSpecId: specA, calleeSpecId: specA })).toBe(true);
  });
});

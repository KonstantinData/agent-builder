import { describe, expect, it } from "vitest";
import { checkForbiddenToolCombinations } from "../../src/harness/forbidden-combinations.js";
import type { ToolId } from "../../src/schema/common.js";
import {
  doubleViolationChildSpecContent,
  exfiltrationCombination,
  forbiddenCombinations,
  validAgentSpecContent,
} from "../fixtures/specs.js";

describe("checkForbiddenToolCombinations", () => {
  it("flags a candidate whose declared tools are a superset of a forbidden combination", () => {
    const reasons = checkForbiddenToolCombinations(doubleViolationChildSpecContent, forbiddenCombinations);
    expect(reasons).toEqual([
      { type: "forbidden_tool_combination", toolIds: exfiltrationCombination },
    ]);
  });

  it("does not flag a candidate that only has a subset of a forbidden combination", () => {
    expect(checkForbiddenToolCombinations(validAgentSpecContent, forbiddenCombinations)).toEqual([]);
  });

  it("ignores a degenerate empty combination instead of matching vacuously", () => {
    const emptyCombination: readonly (readonly ToolId[])[] = [[]];
    expect(checkForbiddenToolCombinations(validAgentSpecContent, emptyCombination)).toEqual([]);
  });

  it("flags every distinct combination that matches", () => {
    const secondCombination: readonly ToolId[] = ["crm.enrich", "fs.read"];
    const reasons = checkForbiddenToolCombinations(doubleViolationChildSpecContent, [
      exfiltrationCombination,
      secondCombination,
    ]);
    expect(reasons).toHaveLength(2);
  });
});

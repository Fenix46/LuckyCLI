import { describe, expect, it } from "vitest";
import { graphImpactLines } from "./graph-cli.js";

describe("graphImpactLines", () => {
  it("renders nodes, locations, relations, and directions", () => {
    expect(
      graphImpactLines("beta", [
        {
          node: { label: "beta", kind: "function", sourceFile: "src/a.ts", sourceLocation: "L5" },
          neighbors: [
            {
              direction: "in",
              relation: "calls",
              node: { label: "alpha", kind: "function", sourceFile: "src/a.ts", sourceLocation: "L1" },
            },
          ],
        },
      ]),
    ).toEqual([
      'Impact for "beta":',
      "beta [function]  src/a.ts:L5",
      "  ← calls  alpha [function]  src/a.ts:L1",
    ]);
  });

  it("renders an explicit empty state", () => {
    expect(graphImpactLines("missing", [])).toEqual(['No graph nodes matched "missing".']);
  });
});

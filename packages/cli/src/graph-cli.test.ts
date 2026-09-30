import { describe, expect, it } from "vitest";
import { blastRadiusLines, graphImpactLines } from "./graph-cli.js";

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

describe("blastRadiusLines", () => {
  it("lists dependents by distance and the files to review", () => {
    const node = (label: string, file: string) => ({ id: label, label, kind: "function" as const, sourceFile: file, sourceLocation: "L1" });
    expect(
      blastRadiusLines(
        "core",
        {
          dependents: [
            { node: node("svc", "svc.ts"), depth: 1, relation: "calls" },
            { node: node("api", "api.ts"), depth: 2, relation: "calls" },
          ],
          files: ["svc.ts", "api.ts"],
          truncated: false,
        },
        3,
      ),
    ).toEqual([
      "Transitive impact of core (up to 3 hops): 2 dependents in 2 files",
      "  direct  calls  svc [function]  svc.ts:L1",
      "  2 hops  calls  api [function]  api.ts:L1",
      "Files to review:",
      "  svc.ts",
      "  api.ts",
    ]);
  });

  it("says when nothing depends on the node", () => {
    expect(blastRadiusLines("leaf", { dependents: [], files: [], truncated: false }, 3)).toEqual([
      "Transitive impact of leaf: nothing in the project depends on it.",
    ]);
  });
});

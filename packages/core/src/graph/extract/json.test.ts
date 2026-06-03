import { describe, expect, it } from "vitest";
import { extractorFor } from "./index.js";
import { jsonExtractor } from "./json.js";
import { parse } from "./parser.js";
import { type GraphNode, validateGraph } from "../types.js";

const SAMPLE = `{
  "name": "demo",
  "version": "1.0.0",
  "scripts": { "build": "tsc", "test": "vitest" },
  "dependencies": { "zod": "^3" },
  "list": [1, 2, 3]
}
`;

async function extract(path: string, source: string) {
  const parsed = await parse("json", source);
  try {
    return jsonExtractor.extract({ path, source, root: parsed.root });
  } finally {
    parsed.dispose();
  }
}

function byLabel(nodes: GraphNode[], label: string) {
  return nodes.filter((n) => n.label === label);
}

describe("json extractor", () => {
  it("extracts a self-consistent graph", async () => {
    const { nodes, edges } = await extract("package.json", SAMPLE);
    expect(validateGraph({ meta: anyMeta(), nodes, edges })).toEqual([]);
  });

  it("emits a file node and a symbol per top-level key", async () => {
    const { nodes, edges } = await extract("package.json", SAMPLE);
    expect(byLabel(nodes, "package.json")[0]?.kind).toBe("file");
    const file = byLabel(nodes, "package.json")[0]!;
    const keys = edges
      .filter((e) => e.source === file.id && e.relation === "defines")
      .map((e) => nodes.find((n) => n.id === e.target))
      .map((n) => n?.label)
      .sort();
    expect(keys).toEqual(["dependencies", "list", "name", "scripts", "version"]);
    expect(byLabel(nodes, "scripts")[0]?.kind).toBe("symbol");
  });

  it("does not recurse into nested objects (top-level only)", async () => {
    const { nodes } = await extract("package.json", SAMPLE);
    expect(byLabel(nodes, "build")).toHaveLength(0);
    expect(byLabel(nodes, "zod")).toHaveLength(0);
  });

  it("is registered for the json language", () => {
    expect(extractorFor("json")).toBe(jsonExtractor);
  });
});

function anyMeta() {
  return { version: 1 as const, root: "/x", builtAt: "now", fileCount: 1 };
}

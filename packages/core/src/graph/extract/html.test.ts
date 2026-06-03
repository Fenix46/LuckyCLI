import { describe, expect, it } from "vitest";
import { htmlExtractor } from "./html.js";
import { extractorFor } from "./index.js";
import { parse } from "./parser.js";
import { type GraphNode, validateGraph } from "../types.js";

const SAMPLE = `<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="style.css">
  <script src="app.js"></script>
</head>
<body>
  <div id="root"></div>
  <img src="logo.png" id="logo">
  <a href="/about">About</a>
</body>
</html>
`;

async function extract(path: string, source: string) {
  const parsed = await parse("html", source);
  try {
    return htmlExtractor.extract({ path, source, root: parsed.root });
  } finally {
    parsed.dispose();
  }
}

function byLabel(nodes: GraphNode[], label: string) {
  return nodes.filter((n) => n.label === label);
}

describe("html extractor", () => {
  it("extracts a self-consistent graph", async () => {
    const { nodes, edges } = await extract("index.html", SAMPLE);
    expect(validateGraph({ meta: anyMeta(), nodes, edges })).toEqual([]);
  });

  it("emits import nodes for script/link/img resources", async () => {
    const { nodes, edges } = await extract("index.html", SAMPLE);
    expect(byLabel(nodes, "style.css")[0]?.kind).toBe("module");
    expect(byLabel(nodes, "app.js")[0]?.kind).toBe("module");
    expect(byLabel(nodes, "logo.png")[0]?.kind).toBe("module");
    const imports = edges.filter((e) => e.relation === "imports");
    expect(imports).toHaveLength(3);
    expect(imports.every((e) => e.confidence === "EXTRACTED")).toBe(true);
  });

  it("emits symbol nodes for elements with an id", async () => {
    const { nodes, edges } = await extract("index.html", SAMPLE);
    expect(byLabel(nodes, "root")[0]?.kind).toBe("symbol");
    expect(byLabel(nodes, "logo")[0]?.kind).toBe("symbol");
    const file = byLabel(nodes, "index.html")[0]!;
    const ids = edges
      .filter((e) => e.source === file.id && e.relation === "defines")
      .map((e) => nodes.find((n) => n.id === e.target))
      .map((n) => n?.label)
      .sort();
    expect(ids).toEqual(["logo", "root"]);
  });

  it("does not import in-page <a href> navigation links", async () => {
    const { nodes } = await extract("index.html", SAMPLE);
    expect(byLabel(nodes, "/about")).toHaveLength(0);
  });

  it("is registered for the html language", () => {
    expect(extractorFor("html")).toBe(htmlExtractor);
  });
});

function anyMeta() {
  return { version: 1 as const, root: "/x", builtAt: "now", fileCount: 1 };
}

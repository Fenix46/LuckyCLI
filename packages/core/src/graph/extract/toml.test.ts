import { describe, expect, it } from "vitest";
import { extractorFor } from "./index.js";
import { parse } from "./parser.js";
import { tomlExtractor } from "./toml.js";
import { type GraphNode, validateGraph } from "../types.js";

const SAMPLE = `title = "demo"
version = "1.0"

[server]
host = "localhost"
port = 8080

[database.primary]
url = "postgres://x"

[[products]]
name = "a"
`;

async function extract(path: string, source: string) {
  const parsed = await parse("toml", source);
  try {
    return tomlExtractor.extract({ path, source, root: parsed.root });
  } finally {
    parsed.dispose();
  }
}

function byLabel(nodes: GraphNode[], label: string) {
  return nodes.filter((n) => n.label === label);
}

describe("toml extractor", () => {
  it("extracts a self-consistent graph", async () => {
    const { nodes, edges } = await extract("config.toml", SAMPLE);
    expect(validateGraph({ meta: anyMeta(), nodes, edges })).toEqual([]);
  });

  it("emits file, top-level key, table and array-table nodes", async () => {
    const { nodes } = await extract("config.toml", SAMPLE);
    expect(byLabel(nodes, "config.toml")[0]?.kind).toBe("file");
    expect(byLabel(nodes, "title")[0]?.kind).toBe("symbol");
    expect(byLabel(nodes, "server")[0]?.kind).toBe("symbol");
    expect(byLabel(nodes, "database.primary")[0]?.kind).toBe("symbol");
    expect(byLabel(nodes, "products")[0]?.kind).toBe("symbol");
  });

  it("attaches a section's keys to the section", async () => {
    const { nodes, edges } = await extract("config.toml", SAMPLE);
    const server = byLabel(nodes, "server")[0]!;
    const keys = edges
      .filter((e) => e.source === server.id && e.relation === "defines")
      .map((e) => nodes.find((n) => n.id === e.target))
      .map((n) => n?.label)
      .sort();
    expect(keys).toEqual(["host", "port"]);
  });

  it("attaches top-level keys and sections to the file", async () => {
    const { nodes, edges } = await extract("config.toml", SAMPLE);
    const file = byLabel(nodes, "config.toml")[0]!;
    const topLevel = edges
      .filter((e) => e.source === file.id && e.relation === "defines")
      .map((e) => nodes.find((n) => n.id === e.target))
      .map((n) => n?.label)
      .sort();
    expect(topLevel).toEqual(["database.primary", "products", "server", "title", "version"]);
  });

  it("is registered for the toml language", () => {
    expect(extractorFor("toml")).toBe(tomlExtractor);
  });
});

function anyMeta() {
  return { version: 1 as const, root: "/x", builtAt: "now", fileCount: 1 };
}

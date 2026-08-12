import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GraphContextEnricher,
  extractMentionCandidates,
  matchMentions,
  renderGraphContext,
} from "./enrich.js";
import { saveGraph } from "./store.js";
import { type Graph, emptyGraph } from "./types.js";

function fixture(): Graph {
  const g = emptyGraph("/repo");
  g.meta.fileCount = 2;
  g.nodes = [
    { id: "src_agent_ts", label: "agent.ts", kind: "file", sourceFile: "src/agent.ts" },
    {
      id: "compacthistory",
      label: "compactHistory",
      kind: "method",
      sourceFile: "src/agent.ts",
      sourceLocation: "L645",
    },
    { id: "send", label: "send", kind: "method", sourceFile: "src/agent.ts", sourceLocation: "L220" },
    {
      id: "load_config",
      label: "load_config",
      kind: "function",
      sourceFile: "src/config.py",
      sourceLocation: "L10",
    },
    {
      id: "mod_react",
      label: "react",
      kind: "module",
      sourceFile: "react",
      external: true,
    },
  ];
  g.edges = [
    { source: "src_agent_ts", target: "compacthistory", relation: "defines", confidence: "EXTRACTED" },
    { source: "src_agent_ts", target: "send", relation: "defines", confidence: "EXTRACTED" },
    { source: "send", target: "compacthistory", relation: "calls", confidence: "EXTRACTED" },
  ];
  return g;
}

describe("extractMentionCandidates", () => {
  it("extracts backticked tokens first, stripping parens and line suffixes", () => {
    const candidates = extractMentionCandidates(
      "Look at `compactHistory()` and `src/agent.ts:L645` please",
    );
    expect(candidates[0]).toEqual({ token: "compactHistory", fromCode: true });
    expect(candidates[1]).toEqual({ token: "src/agent.ts", fromCode: true });
  });

  it("extracts identifier-shaped prose (camelCase, snake_case) but not plain words", () => {
    const tokens = extractMentionCandidates(
      "The compactHistory logic reads load_config before it runs",
    ).map((c) => c.token);
    expect(tokens).toContain("compactHistory");
    expect(tokens).toContain("load_config");
    expect(tokens).not.toContain("logic");
    expect(tokens).not.toContain("before");
  });

  it("deduplicates and caps candidates", () => {
    const candidates = extractMentionCandidates("`foo` and foo and `foo`");
    expect(candidates.filter((c) => c.token === "foo")).toHaveLength(1);
  });
});

describe("matchMentions", () => {
  it("resolves exact symbol and path mentions, excluding external nodes", () => {
    const g = fixture();
    const nodes = matchMentions(g, "why is `compactHistory` slow? uses `react` and src/agent.ts");
    const ids = nodes.map((n) => n.id);
    expect(ids).toContain("compacthistory");
    expect(ids).toContain("src_agent_ts");
    expect(ids).not.toContain("mod_react");
  });

  it("requires case-sensitive label match for prose-derived tokens", () => {
    const g = fixture();
    // "CompactHistory" is identifier-shaped but doesn't match the label exactly.
    expect(matchMentions(g, "CompactHistory is broken")).toEqual([]);
    expect(matchMentions(g, "compactHistory is broken").map((n) => n.id)).toEqual([
      "compacthistory",
    ]);
  });

  it("collapses a path mention to the file node even when the file has many symbols", () => {
    const g = fixture();
    // Give src/agent.ts enough symbols to trip the ambiguity guard if the
    // path resolved to all of them instead of the file node.
    for (let i = 0; i < 6; i++) {
      g.nodes.push({
        id: `extra_${i}`,
        label: `extra${i}`,
        kind: "function",
        sourceFile: "src/agent.ts",
        sourceLocation: `L${900 + i}`,
      });
    }
    const nodes = matchMentions(g, "guarda src/agent.ts e dimmi cosa fa");
    expect(nodes.map((n) => n.id)).toEqual(["src_agent_ts"]);
  });

  it("skips nodes already injected this session", () => {
    const g = fixture();
    const nodes = matchMentions(g, "`compactHistory`", new Set(["compacthistory"]));
    expect(nodes).toEqual([]);
  });

  it("never matches ordinary sentence-leading capitalized words", () => {
    const g = fixture();
    expect(matchMentions(g, "Send the report tomorrow")).toEqual([]);
  });
});

describe("renderGraphContext", () => {
  it("renders symbol cards with location and call relations", () => {
    const g = fixture();
    const block = renderGraphContext(g, matchMentions(g, "`compactHistory`"));
    expect(block).toContain("<graph-context>");
    expect(block).toContain("compactHistory (method) — src/agent.ts:L645");
    expect(block).toContain("callers: send");
    expect(block).toContain("</graph-context>");
  });

  it("renders file cards with their symbols", () => {
    const g = fixture();
    const block = renderGraphContext(g, matchMentions(g, "look at src/agent.ts"));
    expect(block).toContain("src/agent.ts (file)");
    expect(block).toContain("symbols: compactHistory, send");
  });
});

describe("GraphContextEnricher", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "lucky-enrich-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns null when the project has no graph", async () => {
    const enricher = new GraphContextEnricher(dir);
    expect(await enricher.enrich("`compactHistory` is broken")).toBeNull();
  });

  it("enriches matching turns and dedupes across the session until compaction", async () => {
    await saveGraph(dir, fixture());
    const enricher = new GraphContextEnricher(dir);

    const first = await enricher.enrich("`compactHistory` is broken");
    expect(first).toContain("compactHistory (method)");

    // Same mention next turn: already injected, nothing to add.
    expect(await enricher.enrich("`compactHistory` again")).toBeNull();

    // After compaction the block may be gone — the mention re-injects.
    enricher.onCompacted();
    expect(await enricher.enrich("`compactHistory` again")).toContain("compactHistory (method)");
  });

  it("picks up a graph built after the first (empty) check", async () => {
    const enricher = new GraphContextEnricher(dir);
    expect(await enricher.enrich("`compactHistory`")).toBeNull();
    await saveGraph(dir, fixture());
    expect(await enricher.enrich("`compactHistory`")).toContain("compactHistory (method)");
  });

  it("returns null on unmatched turns", async () => {
    await saveGraph(dir, fixture());
    const enricher = new GraphContextEnricher(dir);
    expect(await enricher.enrich("hello, how are you?")).toBeNull();
  });
});

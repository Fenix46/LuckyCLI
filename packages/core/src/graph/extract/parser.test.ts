import { describe, expect, it } from "vitest";
import { lineLabel } from "./types.js";
import { loadLanguage, parse } from "./parser.js";

describe("tree-sitter parser", () => {
  it("loads a grammar and parses TypeScript into a usable tree", async () => {
    const parsed = await parse("typescript", "function foo() {\n  return 1;\n}\n");
    try {
      expect(parsed.root.type).toBe("program");
      const fn = parsed.root.namedChildren.find((n) => n?.type === "function_declaration");
      expect(fn).toBeTruthy();
      expect(fn?.childForFieldName("name")?.text).toBe("foo");
      expect(lineLabel(fn!)).toBe("L1");
    } finally {
      parsed.dispose();
    }
  });

  it("parses Python too and caches the language", async () => {
    const first = await loadLanguage("python");
    const second = await loadLanguage("python");
    expect(first).toBe(second); // cached, not reloaded

    const parsed = await parse("python", "def greet():\n    return 'hi'\n");
    try {
      const fn = parsed.root.namedChildren.find((n) => n?.type === "function_definition");
      expect(fn?.childForFieldName("name")?.text).toBe("greet");
    } finally {
      parsed.dispose();
    }
  });
});

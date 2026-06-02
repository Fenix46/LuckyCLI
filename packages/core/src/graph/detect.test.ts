import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectFiles, languageForPath } from "./detect.js";

describe("detect", () => {
  it("maps extensions to languages", () => {
    expect(languageForPath("src/a.ts")).toBe("typescript");
    expect(languageForPath("src/a.mts")).toBe("typescript");
    expect(languageForPath("ui/App.tsx")).toBe("tsx");
    expect(languageForPath("x.js")).toBe("javascript");
    expect(languageForPath("x.mjs")).toBe("javascript");
    expect(languageForPath("m.py")).toBe("python");
    expect(languageForPath("readme.md")).toBeUndefined();
    expect(languageForPath("data.json")).toBeUndefined();
  });

  describe("collectFiles", () => {
    let root: string;

    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), "lucky-detect-"));
    });

    afterEach(async () => {
      await rm(root, { recursive: true, force: true });
    });

    it("collects source files and skips junk dirs and .lucky", async () => {
      await mkdir(join(root, "src"), { recursive: true });
      await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
      await mkdir(join(root, ".lucky", "graph"), { recursive: true });
      await writeFile(join(root, "src", "a.ts"), "export const a = 1;\n");
      await writeFile(join(root, "src", "b.py"), "x = 1\n");
      await writeFile(join(root, "README.md"), "# hi\n");
      await writeFile(join(root, "node_modules", "pkg", "dep.js"), "module.exports = 1;\n");
      await writeFile(join(root, ".lucky", "graph", "graph.json"), "{}\n");

      const files = await collectFiles(root);
      const rels = files.map((f) => f.relPath).sort();

      expect(rels).toEqual([join("src", "a.ts"), join("src", "b.py")]);
      expect(files.find((f) => f.relPath.endsWith("a.ts"))?.language).toBe("typescript");
      expect(files.find((f) => f.relPath.endsWith("b.py"))?.language).toBe("python");
    });
  });
});

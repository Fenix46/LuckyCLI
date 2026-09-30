import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultToolRegistry } from "../tools/builtin/index.js";
import { isOwned, ownershipOverlaps, restrictWrites } from "./ownership.js";

describe("ownership", () => {
  it("matches paths, directories and globs", () => {
    expect(isOwned("src/api/user.ts", ["src/api"])).toBe(true);
    expect(isOwned("./src/api/user.ts", ["src/api/"])).toBe(true);
    expect(isOwned("src/apix/user.ts", ["src/api"])).toBe(false);
    expect(isOwned("docs/guide/intro.md", ["docs/**"])).toBe(true);
    expect(isOwned("docs/a.md", ["docs/*.md"])).toBe(true);
    expect(isOwned("docs/guide/a.md", ["docs/*.md"])).toBe(false);
  });

  it("detects overlapping claims conservatively", () => {
    expect(ownershipOverlaps(["src/api"], ["docs"])).toBe(false);
    expect(ownershipOverlaps(["src"], ["src/api/**"])).toBe(true);
    expect(ownershipOverlaps(["README.md"], ["README.md"])).toBe(true);
    expect(ownershipOverlaps(["**/*.md"], ["src"])).toBe(true); // no literal base: could touch anything
  });

  it("refuses writes outside the owned files and allows the rest", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "lucky-own-"));
    const tools = restrictWrites(defaultToolRegistry(), ["docs/**"]);
    const outside = await tools.execute("write_file", { path: "src/a.ts", content: "x" }, { cwd });
    expect(outside.isError).toBe(true);
    expect(outside.content).toContain("may only write docs/**");
    const inside = await tools.execute("write_file", { path: "docs/a.md", content: "hi" }, { cwd });
    expect(inside.isError).toBeFalsy();
    expect(await readFile(join(cwd, "docs/a.md"), "utf8")).toBe("hi");
    const patch = await tools.execute(
      "apply_patch",
      { patch: "--- /dev/null\n+++ b/src/b.ts\n@@ -0,0 +1 @@\n+x\n" },
      { cwd },
    );
    expect(patch.isError).toBe(true);
    await rm(cwd, { recursive: true, force: true });
  });
});

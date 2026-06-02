import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../types.js";
import { applyPatchTool } from "./apply-patch.js";
import { editFileTool } from "./edit-file.js";
import { writeFileTool } from "./write-file.js";

describe("file tools notify onFilesChanged", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "lucky-onchange-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  function ctx(onFilesChanged: (paths: string[]) => void): ToolContext {
    return { cwd, onFilesChanged };
  }

  it("write_file reports the written path on success", async () => {
    const spy = vi.fn();
    await writeFileTool.execute({ path: "a.ts", content: "export const a = 1;\n" }, ctx(spy));
    expect(spy).toHaveBeenCalledWith(["a.ts"]);
  });

  it("write_file does not report when refusing to overwrite", async () => {
    await writeFileTool.execute({ path: "a.ts", content: "x" }, ctx(() => {}));
    const spy = vi.fn();
    const res = await writeFileTool.execute(
      { path: "a.ts", content: "y", overwrite: false },
      ctx(spy),
    );
    expect(res.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("edit_file reports the edited path", async () => {
    await writeFileTool.execute({ path: "a.ts", content: "alpha\n" }, ctx(() => {}));
    const spy = vi.fn();
    await editFileTool.execute({ path: "a.ts", oldString: "alpha", newString: "beta" }, ctx(spy));
    expect(spy).toHaveBeenCalledWith(["a.ts"]);
  });

  it("apply_patch reports every changed file", async () => {
    const spy = vi.fn();
    const patch = [
      "--- /dev/null",
      "+++ b/new.ts",
      "@@ -0,0 +1,1 @@",
      "+export const n = 1;",
      "",
    ].join("\n");
    const res = await applyPatchTool.execute({ patch }, ctx(spy));
    expect(res.isError ?? false).toBe(false);
    expect(spy).toHaveBeenCalledWith(["new.ts"]);
  });
});

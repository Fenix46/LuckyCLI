import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { editFileTool } from "./builtin/edit-file.js";
import {
  readTextViaContext,
  tryReadTextViaContext,
  writeTextViaContext,
} from "./file-access.js";
import type { ToolContext } from "./types.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "lucky-file-access-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return { cwd: dir, ...overrides };
}

describe("readTextViaContext", () => {
  it("prefers the host's view when it has one", async () => {
    const abs = join(dir, "a.txt");
    await writeFile(abs, "on disk", "utf8");
    const text = await readTextViaContext(
      ctx({ readTextFile: async () => "in buffer" }),
      abs,
    );
    expect(text).toBe("in buffer");
  });

  it("falls back to disk when the host has no view or fails", async () => {
    const abs = join(dir, "a.txt");
    await writeFile(abs, "on disk", "utf8");
    expect(await readTextViaContext(ctx({ readTextFile: async () => null }), abs)).toBe(
      "on disk",
    );
    expect(
      await readTextViaContext(
        ctx({
          readTextFile: async () => {
            throw new Error("editor gone");
          },
        }),
        abs,
      ),
    ).toBe("on disk");
    expect(await readTextViaContext(ctx(), abs)).toBe("on disk");
  });

  it("tryRead resolves undefined for a missing file", async () => {
    expect(await tryReadTextViaContext(ctx(), join(dir, "missing.txt"))).toBeUndefined();
  });
});

describe("writeTextViaContext", () => {
  it("routes writes through the host when available", async () => {
    const abs = join(dir, "a.txt");
    const hostWrite = vi.fn(async () => {});
    await writeTextViaContext(ctx({ writeTextFile: hostWrite }), abs, "new text");
    expect(hostWrite).toHaveBeenCalledWith(abs, "new text");
    // Nothing lands on disk — the host owns persistence.
    await expect(readFile(abs, "utf8")).rejects.toThrow();
  });

  it("falls back to disk when the host write fails", async () => {
    const abs = join(dir, "a.txt");
    await writeTextViaContext(
      ctx({
        writeTextFile: async () => {
          throw new Error("editor gone");
        },
      }),
      abs,
      "recovered",
    );
    expect(await readFile(abs, "utf8")).toBe("recovered");
  });
});

describe("edit_file through host-backed access", () => {
  it("matches against the buffer content and writes back through the host", async () => {
    const abs = join(dir, "a.txt");
    // Disk is stale; the editor buffer has the current text.
    await writeFile(abs, "stale disk content", "utf8");
    let buffer = "const value = 1;\n";
    const result = await editFileTool.execute(
      { path: "a.txt", oldString: "value = 1", newString: "value = 2" },
      ctx({
        readTextFile: async () => buffer,
        writeTextFile: async (_abs, content) => {
          buffer = content;
        },
      }),
    );
    expect(result.isError ?? false).toBe(false);
    expect(buffer).toBe("const value = 2;\n");
    // Disk untouched: the host owns the write.
    expect(await readFile(abs, "utf8")).toBe("stale disk content");
  });
});

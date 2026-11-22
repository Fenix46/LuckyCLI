import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileStateLedger } from "../file-state.js";
import { ToolRegistry } from "../registry.js";
import { notebookEditTool } from "./notebook-edit.js";
import { readFileTool } from "./read-file.js";

function notebook() {
  return {
    cells: [
      {
        cell_type: "markdown",
        id: "md1",
        metadata: {},
        source: ["# Title\n", "Some text"],
      },
      {
        cell_type: "code",
        id: "code1",
        metadata: { tags: ["keep"] },
        source: ["print(1)"],
        execution_count: 3,
        outputs: [{ output_type: "stream", name: "stdout", text: ["1\n"] }],
      },
    ],
    metadata: { kernelspec: { name: "python3" } },
    nbformat: 4,
    nbformat_minor: 5,
  };
}

describe("notebook_edit", () => {
  let root: string;
  let registry: ToolRegistry;
  let fileState: FileStateLedger;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "lucky-notebook-"));
    registry = new ToolRegistry().register(readFileTool).register(notebookEditTool);
    fileState = new FileStateLedger();
    await writeFile(join(root, "nb.ipynb"), `${JSON.stringify(notebook(), null, 2)}\n`, "utf8");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function readNotebook(): Promise<ReturnType<typeof notebook>> {
    return JSON.parse(await readFile(join(root, "nb.ipynb"), "utf8")) as ReturnType<typeof notebook>;
  }

  it("requires a read before editing", async () => {
    const result = await registry.execute(
      "notebook_edit",
      { notebook_path: "nb.ipynb", cell_id: "code1", new_source: "print(2)" },
      { cwd: root, fileState, toolCallId: "edit-1" },
    );
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/read nb\.ipynb with read_file/i);
  });

  it("replaces a code cell, clears its outputs and keeps metadata", async () => {
    await registry.execute("read_file", { path: "nb.ipynb" }, { cwd: root, fileState, toolCallId: "read-1" });
    const result = await registry.execute(
      "notebook_edit",
      { notebook_path: "nb.ipynb", cell_id: "code1", new_source: "print(2)" },
      { cwd: root, fileState, toolCallId: "edit-1" },
    );
    expect(result.isError).toBeUndefined();
    const updated = await readNotebook();
    expect(updated.cells[1]).toMatchObject({
      cell_type: "code",
      id: "code1",
      source: ["print(2)"],
      execution_count: null,
      outputs: [],
      metadata: { tags: ["keep"] },
    });
    expect(updated.metadata).toEqual({ kernelspec: { name: "python3" } });
    expect(result.metadata?.diff?.[0]?.path).toBe("nb.ipynb");
  });

  it("inserts a cell after a given cell and at the end", async () => {
    await registry.execute("read_file", { path: "nb.ipynb" }, { cwd: root, fileState, toolCallId: "read-1" });
    const first = await registry.execute(
      "notebook_edit",
      { notebook_path: "nb.ipynb", edit_mode: "insert", cell_id: "md1", new_source: "print(0)" },
      { cwd: root, fileState, toolCallId: "edit-1" },
    );
    expect(first.isError).toBeUndefined();
    const second = await registry.execute(
      "notebook_edit",
      { notebook_path: "nb.ipynb", edit_mode: "insert", new_source: "print(3)" },
      { cwd: root, fileState, toolCallId: "edit-2" },
    );
    expect(second.isError).toBeUndefined();
    const updated = await readNotebook();
    expect(updated.cells.map((cell) => cell.id)).toEqual(["md1", expect.any(String), "code1", expect.any(String)]);
    expect(updated.cells[1]).toMatchObject({ cell_type: "code", source: ["print(0)"], outputs: [], execution_count: null });
    expect(updated.cells[3]).toMatchObject({ cell_type: "code", source: ["print(3)"] });
  });

  it("deletes a cell by id or index", async () => {
    await registry.execute("read_file", { path: "nb.ipynb" }, { cwd: root, fileState, toolCallId: "read-1" });
    const result = await registry.execute(
      "notebook_edit",
      { notebook_path: "nb.ipynb", edit_mode: "delete", cell_id: "0" },
      { cwd: root, fileState, toolCallId: "edit-1" },
    );
    expect(result.isError).toBeUndefined();
    const updated = await readNotebook();
    expect(updated.cells.map((cell) => cell.id)).toEqual(["code1"]);
  });

  it("changes a markdown cell into code and adds the code fields", async () => {
    await registry.execute("read_file", { path: "nb.ipynb" }, { cwd: root, fileState, toolCallId: "read-1" });
    const result = await registry.execute(
      "notebook_edit",
      { notebook_path: "nb.ipynb", cell_id: "md1", cell_type: "code", new_source: "x = 1" },
      { cwd: root, fileState, toolCallId: "edit-1" },
    );
    expect(result.isError).toBeUndefined();
    const updated = await readNotebook();
    expect(updated.cells[0]).toMatchObject({
      cell_type: "code",
      id: "md1",
      source: ["x = 1"],
      outputs: [],
      execution_count: null,
    });
  });

  it("refuses a stale edit and reports unknown cells", async () => {
    await registry.execute("read_file", { path: "nb.ipynb" }, { cwd: root, fileState, toolCallId: "read-1" });
    await writeFile(join(root, "nb.ipynb"), `${JSON.stringify({ ...notebook(), metadata: {} }, null, 2)}\n`, "utf8");
    const stale = await registry.execute(
      "notebook_edit",
      { notebook_path: "nb.ipynb", cell_id: "code1", new_source: "print(2)" },
      { cwd: root, fileState, toolCallId: "edit-1" },
    );
    expect(stale.isError).toBe(true);
    expect(stale.content).toMatch(/changed on disk/i);

    await registry.execute("read_file", { path: "nb.ipynb" }, { cwd: root, fileState, toolCallId: "read-2" });
    const missing = await registry.execute(
      "notebook_edit",
      { notebook_path: "nb.ipynb", cell_id: "nope", new_source: "x" },
      { cwd: root, fileState, toolCallId: "edit-2" },
    );
    expect(missing.isError).toBe(true);
    expect(missing.content).toMatch(/No cell "nope"/);
  });

  it("rejects a malformed notebook and path traversal", async () => {
    await writeFile(join(root, "bad.ipynb"), "not json", "utf8");
    await registry.execute("read_file", { path: "bad.ipynb" }, { cwd: root, fileState, toolCallId: "read-1" });
    const malformed = await registry.execute(
      "notebook_edit",
      { notebook_path: "bad.ipynb", cell_id: "x", new_source: "y" },
      { cwd: root, fileState, toolCallId: "edit-1" },
    );
    expect(malformed.isError).toBe(true);
    expect(malformed.content).toMatch(/valid JSON notebook/i);

    const traversal = await registry.execute(
      "notebook_edit",
      { notebook_path: "../outside.ipynb", cell_id: "x", new_source: "y" },
      { cwd: root, fileState, toolCallId: "edit-2" },
    );
    expect(traversal.isError).toBe(true);
  });
});

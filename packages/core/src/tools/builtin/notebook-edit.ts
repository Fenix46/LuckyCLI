import { randomUUID } from "node:crypto";
import { z } from "zod";
import { fileDiff } from "../../diff.js";
import { describeFileStateFailure } from "../file-state.js";
import { readTextViaContext, writeTextViaContext } from "../file-access.js";
import { resolveExistingInsideCwd } from "../path.js";
import { defineTool } from "../types.js";

type NotebookCell = {
  cell_type: string;
  source: string | string[];
  metadata?: Record<string, unknown>;
  id?: string;
  execution_count?: number | null;
  outputs?: unknown[];
  [key: string]: unknown;
};

type Notebook = {
  cells: NotebookCell[];
  metadata?: Record<string, unknown>;
  nbformat?: number;
  nbformat_minor?: number;
  [key: string]: unknown;
};

const notebookCellType = z.enum(["code", "markdown"]);

export const notebookEditTool = defineTool({
  name: "notebook_edit",
  description:
    "Edit a Jupyter notebook (.ipynb), relative to the working directory. " +
    "Use edit_mode='replace' to change a cell's source (or its cell_type), " +
    "'insert' to add a cell after cell_id (or at the end), and 'delete' to " +
    "remove one. Read the notebook first; a stale edit is refused. Code cells " +
    "have their outputs and execution_count cleared when their source changes.",
  schema: z.object({
    notebook_path: z.string().describe("Notebook path, relative to the working directory."),
    cell_id: z
      .string()
      .optional()
      .describe("Cell id (or 0-based index as a string). Required for replace/delete; optional for insert."),
    new_source: z
      .string()
      .optional()
      .describe("New cell source. Required for replace and insert; ignored for delete."),
    cell_type: notebookCellType
      .optional()
      .describe("Cell type for replace/insert (default: the existing type, or code on insert)."),
    edit_mode: z
      .enum(["replace", "insert", "delete"])
      .optional()
      .describe("What to do (default: replace)."),
  }),
  async execute({ notebook_path, cell_id, new_source, cell_type, edit_mode }, ctx) {
    const mode = edit_mode ?? "replace";
    try {
      const abs = await resolveExistingInsideCwd(ctx.cwd, notebook_path);
      const original = await readTextViaContext(ctx, abs);
      if (ctx.fileState) {
        const state = ctx.fileState.check(abs, original);
        if (!state.ok) {
          return { content: describeFileStateFailure(notebook_path, state.reason), isError: true };
        }
      }

      const notebook = parseNotebook(original);
      if (mode === "delete") {
        if (!cell_id) throw new Error("cell_id is required for delete.");
        const index = findCell(notebook.cells, cell_id);
        if (index < 0) throw new Error(`No cell "${cell_id}" in ${notebook_path}.`);
        notebook.cells.splice(index, 1);
      } else if (mode === "insert") {
        if (new_source === undefined) throw new Error("new_source is required for insert.");
        const type = cell_type ?? "code";
        const cell = makeCell(type, new_source, notebook);
        const index = cell_id ? findCell(notebook.cells, cell_id) : -1;
        if (cell_id && index < 0) throw new Error(`No cell "${cell_id}" in ${notebook_path}.`);
        notebook.cells.splice(index < 0 ? notebook.cells.length : index + 1, 0, cell);
      } else {
        if (!cell_id) throw new Error("cell_id is required for replace.");
        if (new_source === undefined) throw new Error("new_source is required for replace.");
        const index = findCell(notebook.cells, cell_id);
        if (index < 0) throw new Error(`No cell "${cell_id}" in ${notebook_path}.`);
        const cell = notebook.cells[index]!;
        const type = cell_type ?? (cell.cell_type === "markdown" ? "markdown" : "code");
        const sourceChanged = sourceText(cell.source) !== new_source;
        const next: NotebookCell = { ...cell, cell_type: type, source: encodeSource(cell.source, new_source) };
        if (type === "code" && (sourceChanged || cell.cell_type !== "code")) {
          next.outputs = [];
          next.execution_count = null;
        }
        if (type === "markdown") {
          delete next.outputs;
          delete next.execution_count;
        }
        notebook.cells[index] = next;
      }

      const updated = `${JSON.stringify(notebook, null, 2)}\n`;
      if (updated === original) {
        return { content: `No change to ${notebook_path}.` };
      }
      await writeTextViaContext(ctx, abs, updated);
      ctx.fileState?.recordWrite(abs, updated);
      ctx.onFilesChanged?.([notebook_path]);
      const diff = fileDiff(notebook_path, original, updated);
      const verb = mode === "delete" ? "Deleted a cell from" : mode === "insert" ? "Inserted a cell into" : "Edited";
      return {
        content: `${verb} ${notebook_path} (+${diff.additions} -${diff.deletions})`,
        metadata: { diff: [diff] },
      };
    } catch (err) {
      return {
        content: `Failed to edit ${notebook_path}: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  },
});

export function parseNotebook(text: string): Notebook {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("not a valid JSON notebook");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("not a notebook object");
  }
  const notebook = value as Notebook;
  if (!Array.isArray(notebook.cells)) throw new Error("notebook has no cells array");
  for (const cell of notebook.cells) {
    if (typeof cell !== "object" || cell === null) throw new Error("notebook contains a non-object cell");
    if (typeof cell.cell_type !== "string") throw new Error("notebook cell has no cell_type");
    if (typeof cell.source !== "string" && !Array.isArray(cell.source)) {
      throw new Error("notebook cell has an invalid source");
    }
  }
  return notebook;
}

function findCell(cells: NotebookCell[], cellId: string): number {
  const byId = cells.findIndex((cell) => cell.id === cellId);
  if (byId >= 0) return byId;
  const index = Number(cellId);
  return Number.isInteger(index) && index >= 0 && index < cells.length ? index : -1;
}

function sourceText(source: string | string[]): string {
  return Array.isArray(source) ? source.join("") : source;
}

function encodeSource(previous: string | string[], text: string): string | string[] {
  if (!Array.isArray(previous)) return text;
  const lines = text.split("\n");
  return lines.map((line, index) => (index === lines.length - 1 ? line : `${line}\n`));
}

function makeCell(type: "code" | "markdown", source: string, notebook: Notebook): NotebookCell {
  const cell: NotebookCell = {
    cell_type: type,
    metadata: {},
    source: encodeSource([], source),
    ...(type === "code" ? { execution_count: null, outputs: [] } : {}),
  };
  if (notebook.nbformat_minor !== undefined && notebook.nbformat_minor >= 5) {
    cell.id = randomUUID().replace(/-/g, "").slice(0, 8);
  }
  return cell;
}

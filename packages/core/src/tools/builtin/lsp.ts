import { z } from "zod";
import { getLspManager } from "../../lsp/manager.js";
import { defineTool } from "../types.js";

export const lspTool = defineTool({
  name: "lsp",
  description:
    "Ask the project's language server for semantic information about code: " +
    "diagnostics (errors/warnings), hover (type and docs), definition, references, " +
    "or symbols. More precise than grep for typed languages and much cheaper than " +
    "reading whole files. Requires a language server in .lsp.json or the global config.",
  readonly: true,
  schema: z.object({
    operation: z
      .enum(["diagnostics", "hover", "definition", "references", "symbols"])
      .describe("What to ask the language server."),
    file_path: z
      .string()
      .optional()
      .describe("File to inspect, relative to the working directory. Required except for workspace symbol search."),
    line: z.number().int().min(1).optional().describe("1-based line for hover/definition/references."),
    character: z.number().int().min(1).optional().describe("1-based character for hover/definition/references."),
    query: z
      .string()
      .optional()
      .describe("For symbols: a workspace query when file_path is omitted, or a filter for file symbols."),
  }),
  async execute({ operation, file_path, line, character, query }, ctx) {
    const lsp = ctx.lsp === null ? undefined : ctx.lsp ?? getLspManager(ctx.cwd);
    if (!lsp) {
      return {
        content:
          "LSP is not configured. Add language servers to .lsp.json in the project root " +
          'or under "lsp" in ~/.luckycli/config.json, for example:\n{"typescript":{' +
          '"command":"typescript-language-server","args":["--stdio"],' +
          '"extensionToLanguage":{".ts":"typescript",".tsx":"typescriptreact"}}}',
        isError: true,
      };
    }
    try {
      const result = await lsp.execute({
        operation,
        ...(file_path !== undefined ? { filePath: file_path } : {}),
        ...(line !== undefined ? { line } : {}),
        ...(character !== undefined ? { character } : {}),
        ...(query !== undefined ? { query } : {}),
      });
      return { content: result.text };
    } catch (error) {
      return {
        content: `LSP ${operation} failed: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
  },
});

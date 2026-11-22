import { describe, expect, it, vi } from "vitest";
import type { LspRequest, LspResult, LspService } from "../../lsp/types.js";
import type { ToolContext } from "../types.js";
import { lspTool } from "./lsp.js";

describe("lsp tool", () => {
  it("explains how to configure a server when none exists", async () => {
    const result = await lspTool.execute({ operation: "diagnostics", file_path: "a.ts" }, {
      cwd: "/tmp/definitely-no-lsp-config",
      lsp: null,
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain(".lsp.json");
    expect(result.content).toContain("typescript-language-server");
  });

  it("forwards the request and returns the formatted text", async () => {
    const execute = vi.fn(async (request: LspRequest): Promise<LspResult> => ({
      text: `ok ${request.operation} ${request.filePath}`,
      server: "fake",
    }));
    const lsp: LspService = { execute, dispose: async () => {} };
    const ctx: ToolContext = { cwd: "/project", lsp };
    const result = await lspTool.execute(
      { operation: "hover", file_path: "src/a.ts", line: 3, character: 5 },
      ctx,
    );
    expect(result.isError).toBeUndefined();
    expect(result.content).toBe("ok hover src/a.ts");
    expect(execute).toHaveBeenCalledWith({
      operation: "hover",
      filePath: "src/a.ts",
      line: 3,
      character: 5,
    });
  });

  it("turns a manager error into an error result", async () => {
    const lsp: LspService = {
      execute: async () => {
        throw new Error("server crashed");
      },
      dispose: async () => {},
    };
    const result = await lspTool.execute({ operation: "symbols", file_path: "a.ts" }, { cwd: "/p", lsp });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("server crashed");
  });
});

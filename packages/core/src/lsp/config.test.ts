import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadLspConfig, serverExtensions } from "./config.js";

describe("loadLspConfig", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "lucky-lspconfig-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("loads a direct project map and normalizes extensions", async () => {
    await writeFile(
      join(cwd, ".lsp.json"),
      JSON.stringify({
        ts: {
          command: "typescript-language-server",
          args: ["--stdio"],
          extensionToLanguage: { ".ts": "typescript", tsx: "typescriptreact" },
        },
      }),
      "utf8",
    );
    const loaded = loadLspConfig(cwd, {}, undefined);
    expect(loaded.errors).toEqual([]);
    expect(loaded.sources).toEqual([join(cwd, ".lsp.json")]);
    expect(serverExtensions(loaded.config.ts!)).toEqual([".ts", ".tsx"]);
  });

  it("accepts lspServers/servers wrappers and fileExtensions", async () => {
    await writeFile(
      join(cwd, ".lsp.json"),
      JSON.stringify({ lspServers: { py: { command: "pyright-langserver", fileExtensions: ["py", ".pyi"] } } }),
      "utf8",
    );
    const wrapped = loadLspConfig(cwd, {}, undefined);
    expect(serverExtensions(wrapped.config.py!)).toEqual([".py", ".pyi"]);

    await writeFile(
      join(cwd, ".lsp.json"),
      JSON.stringify({ servers: { go: { command: "gopls", fileExtensions: [".go"] } } }),
      "utf8",
    );
    expect(loadLspConfig(cwd, {}, undefined).config.go?.command).toBe("gopls");
  });

  it("merges global and project servers, project winning", async () => {
    await writeFile(
      join(cwd, ".lsp.json"),
      JSON.stringify({ ts: { command: "project-ts", fileExtensions: [".ts"] } }),
      "utf8",
    );
    const loaded = loadLspConfig(
      cwd,
      {},
      {
        ts: { command: "global-ts", fileExtensions: [".ts"] },
        py: { command: "pyright", fileExtensions: [".py"] },
      },
    );
    expect(loaded.config.ts?.command).toBe("project-ts");
    expect(loaded.config.py?.command).toBe("pyright");
    expect(loaded.sources).toHaveLength(2);
  });

  it("reports invalid servers and keeps the valid ones", async () => {
    await writeFile(
      join(cwd, ".lsp.json"),
      JSON.stringify({
        ok: { command: "x", fileExtensions: [".x"] },
        noCommand: { fileExtensions: [".y"] },
        noExtensions: { command: "z" },
      }),
      "utf8",
    );
    const loaded = loadLspConfig(cwd, {}, undefined);
    expect(Object.keys(loaded.config)).toEqual(["ok"]);
    expect(loaded.errors.join("\n")).toMatch(/noCommand" needs a command/);
    expect(loaded.errors.join("\n")).toMatch(/noExtensions" needs extensionToLanguage or fileExtensions/);
  });

  it("uses LUCKY_LSP_FILE and reports broken JSON", async () => {
    const file = join(cwd, "team-lsp.json");
    await writeFile(file, JSON.stringify({ ts: { command: "ts", fileExtensions: [".ts"] } }), "utf8");
    expect(loadLspConfig(cwd, { LUCKY_LSP_FILE: file }, undefined).config.ts?.command).toBe("ts");

    await writeFile(file, "{ nope", "utf8");
    const broken = loadLspConfig(cwd, { LUCKY_LSP_FILE: file }, undefined);
    expect(broken.errors[0]).toMatch(/team-lsp\.json/);
  });
});

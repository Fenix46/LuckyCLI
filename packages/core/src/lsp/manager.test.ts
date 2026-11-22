import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LspManager } from "./manager.js";

const FAKE_SERVER = String.raw`
const buffer = [];
let pending = Buffer.alloc(0);
function send(message) {
  const payload = JSON.stringify(message);
  process.stdout.write("Content-Length: " + Buffer.byteLength(payload) + "\r\n\r\n" + payload);
}
function handle(message) {
  const method = message.method;
  if (method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { capabilities: {
      hoverProvider: true, definitionProvider: true, referencesProvider: true, documentSymbolProvider: true
    } } });
    return;
  }
  if (method === "initialized") return;
  if (method === "shutdown") { send({ jsonrpc: "2.0", id: message.id, result: null }); return; }
  if (method === "exit") { process.exit(0); }
  if (method === "textDocument/didOpen" || method === "textDocument/didChange") {
    send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: {
      uri: message.params.textDocument.uri,
      diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: 1, message: "boom", source: "fake" }]
    } });
    return;
  }
  const uri = message.params && message.params.textDocument ? message.params.textDocument.uri : "file:///x";
  if (method === "textDocument/hover") {
    send({ jsonrpc: "2.0", id: message.id, result: { contents: { kind: "markdown", value: "const x: number" }, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } } });
    return;
  }
  if (method === "textDocument/definition") {
    send({ jsonrpc: "2.0", id: message.id, result: [{ uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }] });
    return;
  }
  if (method === "textDocument/references") {
    send({ jsonrpc: "2.0", id: message.id, result: [
      { uri, range: { start: { line: 0, character: 0 } } },
      { uri, range: { start: { line: 1, character: 2 } } }
    ] });
    return;
  }
  if (method === "textDocument/documentSymbol") {
    send({ jsonrpc: "2.0", id: message.id, result: [{ name: "x", kind: 13, range: { start: { line: 0, character: 0 } }, children: [{ name: "y", kind: 6, range: { start: { line: 1, character: 2 } } }] }] });
    return;
  }
  if (method === "workspace/symbol") {
    send({ jsonrpc: "2.0", id: message.id, result: [{ name: "findMe", kind: 12, location: { uri, range: { start: { line: 2, character: 0 } } } }] });
    return;
  }
  if (message.id !== undefined) {
    send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "unknown method " + method } });
  }
}
process.stdin.on("data", (chunk) => {
  pending = Buffer.concat([pending, chunk]);
  while (true) {
    const end = pending.indexOf("\r\n\r\n");
    if (end < 0) return;
    const header = pending.subarray(0, end).toString();
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) { pending = pending.subarray(end + 4); continue; }
    const length = Number(match[1]);
    if (pending.length < end + 4 + length) return;
    const body = pending.subarray(end + 4, end + 4 + length).toString();
    pending = pending.subarray(end + 4 + length);
    handle(JSON.parse(body));
  }
});
`;

describe("LspManager", () => {
  let cwd: string;
  let manager: LspManager | undefined;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "lucky-lsp-"));
    const server = join(cwd, "fake-lsp.mjs");
    await writeFile(server, FAKE_SERVER, "utf8");
    await writeFile(join(cwd, "sample.ts"), "const x = 1;\n", "utf8");
    await writeFile(
      join(cwd, ".lsp.json"),
      JSON.stringify({
        fake: {
          command: process.execPath,
          args: [server],
          extensionToLanguage: { ".ts": "typescript" },
        },
      }),
      "utf8",
    );
  });

  afterEach(async () => {
    await manager?.dispose();
    await rm(cwd, { recursive: true, force: true });
  });

  it("returns push diagnostics", async () => {
    manager = new LspManager(
      {
        fake: {
          command: process.execPath,
          args: [join(cwd, "fake-lsp.mjs")],
          extensionToLanguage: { ".ts": "typescript" },
        },
      },
      cwd,
    );
    const result = await manager.execute({ operation: "diagnostics", filePath: "sample.ts" });
    expect(result.server).toBe("fake");
    expect(result.text).toContain("sample.ts:1:1: error boom [fake]");
  });

  it("returns hover, definition, references and symbols", async () => {
    manager = new LspManager(
      {
        fake: {
          command: process.execPath,
          args: [join(cwd, "fake-lsp.mjs")],
          extensionToLanguage: { ".ts": "typescript" },
        },
      },
      cwd,
    );
    const hover = await manager.execute({ operation: "hover", filePath: "sample.ts", line: 1, character: 7 });
    expect(hover.text).toContain("const x: number");

    const definition = await manager.execute({ operation: "definition", filePath: "sample.ts", line: 1, character: 7 });
    expect(definition.text).toBe("sample.ts:1:1");

    const references = await manager.execute({ operation: "references", filePath: "sample.ts", line: 1, character: 7 });
    expect(references.text).toBe("sample.ts:1:1\nsample.ts:2:3");

    const symbols = await manager.execute({ operation: "symbols", filePath: "sample.ts" });
    expect(symbols.text).toBe("variable x:1\n  method y:2");
  });

  it("searches workspace symbols without a file", async () => {
    manager = new LspManager(
      {
        fake: {
          command: process.execPath,
          args: [join(cwd, "fake-lsp.mjs")],
          extensionToLanguage: { ".ts": "typescript" },
        },
      },
      cwd,
    );
    const result = await manager.execute({ operation: "symbols", query: "find" });
    expect(result.text).toBe("function findMe:3");
  });

  it("reports an unconfigured extension and a missing file", async () => {
    manager = new LspManager(
      {
        fake: {
          command: process.execPath,
          args: [join(cwd, "fake-lsp.mjs")],
          extensionToLanguage: { ".ts": "typescript" },
        },
      },
      cwd,
    );
    await expect(manager.execute({ operation: "hover", filePath: "a.py" })).rejects.toThrow(
      /No language server is configured for ".py"/,
    );
    await expect(manager.execute({ operation: "hover", filePath: "missing.ts" })).rejects.toThrow();
  });
});

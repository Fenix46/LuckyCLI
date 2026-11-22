import { readFile } from "node:fs/promises";
import { extname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CORE_VERSION } from "../version.js";
import { LspClient } from "./client.js";
import { loadLspConfig, serverExtensions } from "./config.js";
import type { LspConfig, LspRequest, LspResult, LspServerConfig, LspService } from "./types.js";

const MAX_RESULT_CHARS = 20_000;
const PUSH_DIAGNOSTICS_WAIT_MS = 1_500;

interface DocumentState {
  version: number;
  languageId: string;
}

interface ServerState {
  name: string;
  config: LspServerConfig;
  client: LspClient;
  initialized: boolean;
  capabilities: Record<string, unknown>;
  documents: Map<string, DocumentState>;
  diagnostics: Map<string, unknown[]>;
  diagnosticWaiters: Map<string, Set<() => void>>;
}

const SYMBOL_KINDS: Record<number, string> = {
  1: "file",
  2: "module",
  3: "namespace",
  4: "package",
  5: "class",
  6: "method",
  7: "property",
  8: "field",
  9: "constructor",
  10: "enum",
  11: "interface",
  12: "function",
  13: "variable",
  14: "constant",
  15: "string",
  16: "number",
  17: "boolean",
  18: "array",
  19: "object",
  20: "key",
  21: "null",
  22: "enum-member",
  23: "struct",
  24: "event",
  25: "operator",
  26: "type-parameter",
};

/**
 * Owns one language server per configured name, starts them lazily, syncs the
 * requested document, and formats the protocol's verbose structures into short
 * model-facing text.
 */
export class LspManager implements LspService {
  private readonly states = new Map<string, ServerState>();

  constructor(
    private readonly config: LspConfig,
    private readonly cwd: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  static fromProject(cwd: string, env: NodeJS.ProcessEnv = process.env): {
    manager?: LspManager;
    errors: string[];
    sources: string[];
  } {
    const loaded = loadLspConfig(cwd, env);
    if (Object.keys(loaded.config).length === 0) {
      return { errors: loaded.errors, sources: loaded.sources };
    }
    return {
      manager: new LspManager(loaded.config, cwd, env),
      errors: loaded.errors,
      sources: loaded.sources,
    };
  }

  async execute(request: LspRequest): Promise<LspResult> {
    if (request.operation !== "symbols" || request.filePath) {
      if (!request.filePath) throw new Error(`${request.operation} needs filePath.`);
    }
    if (request.operation === "symbols" && request.query && !request.filePath) {
      const state = await this.firstState();
      const result = await state.client.request("workspace/symbol", { query: request.query });
      return { text: this.formatSymbols(result, request.query), server: state.name };
    }

    const filePath = request.filePath!;
    const { name, state, languageId } = await this.stateForFile(filePath);
    if (request.operation === "diagnostics") {
      return { ...(await this.diagnostics(state, filePath, languageId)), server: name };
    }
    await this.openDocument(state, filePath, languageId);

    switch (request.operation) {
      case "hover": {
        const position = this.position(request);
        const result = await state.client.request("textDocument/hover", {
          textDocument: { uri: this.uri(filePath) },
          position,
        });
        return { ...this.formatHover(result, filePath, position), server: name };
      }
      case "definition": {
        const result = await state.client.request("textDocument/definition", {
          textDocument: { uri: this.uri(filePath) },
          position: this.position(request),
        });
        return { ...this.formatLocations(result, "definition"), server: name };
      }
      case "references": {
        const result = await state.client.request("textDocument/references", {
          textDocument: { uri: this.uri(filePath) },
          position: this.position(request),
          context: { includeDeclaration: true },
        });
        return { ...this.formatLocations(result, "reference"), server: name };
      }
      case "symbols": {
        const result = await state.client.request("textDocument/documentSymbol", {
          textDocument: { uri: this.uri(filePath) },
        });
        return {
          text: this.formatSymbols(result, request.query),
          server: name,
        };
      }
    }
  }

  async dispose(): Promise<void> {
    await Promise.all(
      [...this.states.values()].map((state) => state.client.dispose().catch(() => {})),
    );
    this.states.clear();
  }

  private position(request: LspRequest): { line: number; character: number } {
    return {
      line: Math.max(0, Math.floor((request.line ?? 1) - 1)),
      character: Math.max(0, Math.floor((request.character ?? 1) - 1)),
    };
  }

  private uri(filePath: string): string {
    return pathToFileURL(this.absolute(filePath)).toString();
  }

  private absolute(filePath: string): string {
    return filePath.startsWith("/") ? filePath : `${this.cwd.replace(/\/$/, "")}/${filePath}`;
  }

  private displayPath(uri: string): string {
    try {
      const path = fileURLToPath(uri);
      const rel = relative(this.cwd, path);
      return rel && !rel.startsWith("..") ? rel : path;
    } catch {
      return uri;
    }
  }

  private async firstState(): Promise<ServerState> {
    const first = Object.entries(this.config)[0];
    if (!first) throw new Error("No language server configured.");
    return this.stateFor(first[0], first[1]);
  }

  private async stateForFile(
    filePath: string,
  ): Promise<{ name: string; state: ServerState; languageId: string }> {
    const extension = extname(filePath).toLowerCase();
    for (const [name, server] of Object.entries(this.config)) {
      if (!serverExtensions(server).includes(extension)) continue;
      return {
        name,
        state: await this.stateFor(name, server),
        languageId: server.extensionToLanguage?.[extension] ?? extension.replace(/^\./, ""),
      };
    }
    const configured = Object.entries(this.config)
      .flatMap(([name, server]) => serverExtensions(server).map((ext) => `${ext} (${name})`))
      .join(", ");
    throw new Error(
      `No language server is configured for "${extension || filePath}". Configured extensions: ${configured || "none"}.`,
    );
  }

  private async stateFor(name: string, server: LspServerConfig): Promise<ServerState> {
    const existing = this.states.get(name);
    if (existing) return existing;
    const client = new LspClient({
      command: server.command,
      ...(server.args ? { args: server.args } : {}),
      cwd: this.cwd,
      ...(server.env ? { env: server.env } : {}),
      ...(server.timeoutMs ? { timeoutMs: server.timeoutMs } : {}),
    });
    const state: ServerState = {
      name,
      config: server,
      client,
      initialized: false,
      capabilities: {},
      documents: new Map(),
      diagnostics: new Map(),
      diagnosticWaiters: new Map(),
    };
    client.onNotification = (method, params) => this.onNotification(state, method, params);
    this.states.set(name, state);
    try {
      const result = (await client.request("initialize", {
        processId: process.pid,
        clientInfo: { name: "LuckyCLI", version: CORE_VERSION },
        rootUri: pathToFileURL(this.cwd).toString(),
        workspaceFolders: [{ uri: pathToFileURL(this.cwd).toString(), name: "workspace" }],
        capabilities: {
          workspace: { configuration: true, workspaceFolders: true },
          textDocument: {
            hover: { contentFormat: ["markdown", "plaintext"] },
            definition: {},
            references: {},
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
            publishDiagnostics: { relatedInformation: false },
            diagnostic: {},
          },
        },
        ...(server.initializationOptions !== undefined
          ? { initializationOptions: server.initializationOptions }
          : {}),
      })) as { capabilities?: Record<string, unknown> };
      state.capabilities = result?.capabilities ?? {};
      client.notify("initialized", {});
      if (server.settings) {
        client.notify("workspace/didChangeConfiguration", { settings: server.settings });
      }
      state.initialized = true;
      return state;
    } catch (error) {
      this.states.delete(name);
      await client.dispose().catch(() => {});
      const stderr = client.stderrTail();
      throw new Error(
        `Language server "${name}" failed to start: ${error instanceof Error ? error.message : String(error)}${stderr ? `\n${stderr}` : ""}`,
      );
    }
  }

  private onNotification(state: ServerState, method: string, params: unknown): void {
    if (method !== "textDocument/publishDiagnostics") return;
    const record = asRecord(params);
    const uri = typeof record?.uri === "string" ? record.uri : undefined;
    if (!uri) return;
    state.diagnostics.set(uri, Array.isArray(record?.diagnostics) ? record.diagnostics : []);
    for (const resolve of state.diagnosticWaiters.get(uri) ?? []) resolve();
    state.diagnosticWaiters.delete(uri);
  }

  private async openDocument(
    state: ServerState,
    filePath: string,
    languageId: string,
  ): Promise<void> {
    const uri = this.uri(filePath);
    const text = await readFile(this.absolute(filePath), "utf8");
    const current = state.documents.get(uri);
    if (!current) {
      state.documents.set(uri, { version: 1, languageId });
      state.client.notify("textDocument/didOpen", {
        textDocument: { uri, languageId, version: 1, text },
      });
      return;
    }
    const version = current.version + 1;
    state.documents.set(uri, { version, languageId });
    state.client.notify("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
  }

  private async diagnostics(
    state: ServerState,
    filePath: string,
    languageId: string,
  ): Promise<LspResult> {
    const uri = this.uri(filePath);
    // Clear before the sync: a push triggered by didOpen must not be discarded.
    state.diagnostics.delete(uri);
    await this.openDocument(state, filePath, languageId);

    if (supportsPullDiagnostics(state.capabilities)) {
      const result = await state.client.request("textDocument/diagnostic", {
        textDocument: { uri },
      });
      const items = diagnosticItems(result);
      state.diagnostics.set(uri, items);
      return this.formatDiagnostics(uri, items);
    }

    await this.waitForDiagnostics(state, uri);
    return this.formatDiagnostics(uri, state.diagnostics.get(uri) ?? []);
  }

  private waitForDiagnostics(state: ServerState, uri: string): Promise<void> {
    if (state.diagnostics.has(uri)) return Promise.resolve();
    return new Promise((resolve) => {
      const waiters = state.diagnosticWaiters.get(uri) ?? new Set();
      waiters.add(resolve);
      state.diagnosticWaiters.set(uri, waiters);
      const timer = setTimeout(() => {
        waiters.delete(resolve);
        resolve();
      }, PUSH_DIAGNOSTICS_WAIT_MS);
      timer.unref?.();
    });
  }

  private formatDiagnostics(uri: string, items: unknown[]): LspResult {
    if (items.length === 0) {
      return { text: `No diagnostics for ${this.displayPath(uri)}.`, empty: true };
    }
    const lines = items.map((item) => {
      const record = asRecord(item);
      const range = asRecord(record?.range);
      const start = asRecord(range?.start);
      const line = typeof start?.line === "number" ? start.line + 1 : undefined;
      const character = typeof start?.character === "number" ? start.character + 1 : undefined;
      const severity = severityLabel(record?.severity);
      const message = typeof record?.message === "string" ? record.message : "diagnostic";
      const source = typeof record?.source === "string" ? ` [${record.source}]` : "";
      const position = line === undefined ? "" : `:${line}${character === undefined ? "" : `:${character}`}`;
      return `${this.displayPath(uri)}${position}: ${severity} ${message}${source}`;
    });
    return { text: bound(lines.join("\n")) };
  }

  private formatHover(result: unknown, filePath: string, position: { line: number; character: number }): LspResult {
    const record = asRecord(result);
    if (!record) return { text: `No hover information at ${filePath}:${position.line + 1}.`, empty: true };
    const text = renderMarkup(record.contents);
    if (!text) return { text: `No hover information at ${filePath}:${position.line + 1}.`, empty: true };
    const range = asRecord(record.range);
    const start = asRecord(range?.start);
    const where =
      typeof start?.line === "number"
        ? `${filePath}:${start.line + 1}:${typeof start.character === "number" ? start.character + 1 : 1}`
        : filePath;
    return { text: bound(`${where}\n${text}`) };
  }

  private formatLocations(result: unknown, label: string): LspResult {
    const locations = Array.isArray(result) ? result : result ? [result] : [];
    if (locations.length === 0) return { text: `No ${label} found.`, empty: true };
    const lines = locations.flatMap((entry) => {
      const record = asRecord(entry);
      if (!record) return [];
      const uri =
        typeof record.uri === "string"
          ? record.uri
          : typeof record.targetUri === "string"
            ? record.targetUri
            : undefined;
      if (!uri) return [];
      const range = asRecord(record.range ?? record.targetSelectionRange ?? record.targetRange);
      const start = asRecord(range?.start);
      const line = typeof start?.line === "number" ? start.line + 1 : undefined;
      const character = typeof start?.character === "number" ? start.character + 1 : undefined;
      return [
        `${this.displayPath(uri)}${line === undefined ? "" : `:${line}${character === undefined ? "" : `:${character}`}`}`,
      ];
    });
    if (lines.length === 0) return { text: `No ${label} found.`, empty: true };
    return { text: bound(lines.join("\n")) };
  }

  private formatSymbols(result: unknown, query: string | undefined): string {
    const entries = Array.isArray(result) ? result : [];
    if (entries.length === 0) {
      return query ? `No symbols matching "${query}".` : "No symbols in this file.";
    }
    const lines: string[] = [];
    const walk = (symbol: unknown, depth: number) => {
      const record = asRecord(symbol);
      if (!record) return;
      const name = typeof record.name === "string" ? record.name : "(anonymous)";
      const kind = SYMBOL_KINDS[Number(record.kind)] ?? "symbol";
      const range = asRecord(record.range ?? asRecord(record.location)?.range);
      const start = asRecord(range?.start);
      const line = typeof start?.line === "number" ? `:${start.line + 1}` : "";
      lines.push(`${"  ".repeat(depth)}${kind} ${name}${line}`);
      if (Array.isArray(record.children)) {
        for (const child of record.children) walk(child, depth + 1);
      }
    };
    for (const entry of entries) walk(entry, 0);
    return bound(lines.join("\n"));
  }
}

function supportsPullDiagnostics(capabilities: Record<string, unknown>): boolean {
  return capabilities.diagnosticProvider !== undefined;
}

function diagnosticItems(result: unknown): unknown[] {
  const record = asRecord(result);
  if (Array.isArray(record?.items)) return record.items;
  return Array.isArray(result) ? result : [];
}

function severityLabel(value: unknown): string {
  switch (Number(value)) {
    case 1:
      return "error";
    case 2:
      return "warning";
    case 3:
      return "info";
    case 4:
      return "hint";
    default:
      return "diagnostic";
  }
}

function renderMarkup(contents: unknown): string {
  if (typeof contents === "string") return contents.trim();
  const record = asRecord(contents);
  if (record && typeof record.value === "string") return record.value.trim();
  if (Array.isArray(contents)) {
    return contents
      .map((entry) => {
        if (typeof entry === "string") return entry;
        const item = asRecord(entry);
        return typeof item?.value === "string" ? item.value : "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

function bound(text: string): string {
  return text.length <= MAX_RESULT_CHARS
    ? text
    : `${text.slice(0, MAX_RESULT_CHARS)}\n[truncated ${text.length - MAX_RESULT_CHARS} chars]`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

// One manager per working directory, rebuilt when .lsp.json/config changes.
const managers = new Map<string, { signature: string; manager: LspManager }>();

/** The project's manager, starting servers lazily; undefined when unconfigured. */
export function getLspManager(cwd: string, env: NodeJS.ProcessEnv = process.env): LspManager | undefined {
  const loaded = loadLspConfig(cwd, env);
  if (Object.keys(loaded.config).length === 0) return undefined;
  const signature = JSON.stringify(loaded.config);
  const existing = managers.get(cwd);
  if (existing?.signature === signature) return existing.manager;
  if (existing) void existing.manager.dispose();
  const manager = new LspManager(loaded.config, cwd, env);
  managers.set(cwd, { signature, manager });
  return manager;
}

/** Close every cached server (host shutdown). */
export async function disposeLspManagers(): Promise<void> {
  const all = [...managers.values()];
  managers.clear();
  await Promise.all(all.map(({ manager }) => manager.dispose().catch(() => {})));
}

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export interface LspClientOptions {
  command: string;
  args?: string[];
  cwd: string;
  env?: Record<string, string>;
  /** Default timeout for requests, in milliseconds. */
  timeoutMs?: number;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_STDERR = 8_000;

/**
 * Minimal JSON-RPC client for a stdio language server. It owns the process,
 * framing and request correlation; feature logic lives in the manager.
 */
export class LspClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly timeoutMs: number;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private stderr = "";
  private disposed = false;
  /** Set by initialize; capabilities gate optional requests. */
  capabilities: Record<string, unknown> = {};
  /** Notifications the server pushes (publishDiagnostics, logs). */
  onNotification: ((method: string, params: unknown) => void) | undefined;

  constructor(options: LspClientOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.child = spawn(options.command, options.args ?? [], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = `${this.stderr}${chunk.toString("utf8")}`.slice(-MAX_STDERR);
    });
    this.child.on("error", (error) => this.failAll(error));
    this.child.on("close", () => this.failAll(new Error("Language server exited.")));
  }

  request(method: string, params: unknown, timeoutMs = this.timeoutMs): Promise<unknown> {
    if (this.disposed) return Promise.reject(new Error("Language server is closed."));
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      this.write({ jsonrpc: "2.0", id, method, params: params ?? null });
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.disposed) return;
    this.write({ jsonrpc: "2.0", method, params: params ?? null });
  }

  /** Last few KB the server wrote to stderr, for error messages. */
  stderrTail(): string {
    return this.stderr.trim();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    try {
      await this.request("shutdown", null, 1_000);
    } catch {
      // The server may already be gone; exit still follows.
    }
    try {
      this.notify("exit");
    } catch {
      // Ignore a closed stdin.
    }
    this.disposed = true;
    const timer = setTimeout(() => this.child.kill("SIGKILL"), 500);
    timer.unref?.();
    this.failAll(new Error("Language server was shut down."));
  }

  private write(message: JsonRpcMessage): void {
    const payload = JSON.stringify(message);
    this.child.stdin.write(`Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`);
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        // Malformed frame; drop its header so the stream can resync.
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (this.buffer.length < start + length) return;
      const body = this.buffer.subarray(start, start + length).toString("utf8");
      this.buffer = this.buffer.subarray(start + length);
      this.dispatch(body);
    }
  }

  private dispatch(body: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(body) as JsonRpcMessage;
    } catch {
      return;
    }
    // A server-initiated request needs a response or the server blocks.
    if (typeof message.method === "string" && message.id !== undefined && message.id !== null) {
      this.answerServerRequest(message.id, message.method);
      return;
    }
    if (message.method) {
      this.onNotification?.(message.method, message.params);
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(new Error(message.error.message ?? `LSP error ${message.error.code ?? ""}`.trim()));
      return;
    }
    pending.resolve(message.result);
  }

  private answerServerRequest(id: number | string, method: string): void {
    let result: unknown = null;
    if (method === "workspace/configuration") result = [];
    this.write({ jsonrpc: "2.0", id, result });
  }

  private failAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

const PORT_START = 17321;
const PORT_TRIES = 10;
const TOKEN_FILE = "browser.json";
const LONG_POLL_MS = 25_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 1_000_000;

interface PendingCommand {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

interface PendingResult {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface Waiter {
  res: ServerResponse;
  timer: ReturnType<typeof setTimeout>;
}

export interface BrowserBridgeInfo {
  port: number;
  token: string;
}

/**
 * Local HTTP bridge between this CLI and the Lucky Chrome extension.
 *
 * The extension long-polls `/next` for commands, executes them with chrome.*
 * APIs, and posts `/result`. A random token, written only to
 * `~/.lucky/browser.json` (0600), authenticates the extension; the server binds
 * to loopback only.
 */
export class BrowserBridge {
  private server: Server | undefined;
  private port: number | undefined;
  private token = "";
  private readonly pending = new Map<string, PendingResult>();
  private readonly queue: PendingCommand[] = [];
  private readonly waiters: Waiter[] = [];
  private lastPollAt = 0;
  private pollCount = 0;
  private closed = false;

  async info(): Promise<BrowserBridgeInfo> {
    await this.ensureStarted();
    return { port: this.port!, token: this.token };
  }

  /** Queue one command for the extension and await its result. */
  async request(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<unknown> {
    await this.ensureStarted();
    // A request racing close() may resume after the pending map was drained.
    if (this.closed) throw new Error("Browser bridge is closed.");
    const id = randomUUID();
    const command: PendingCommand = { id, method, params };
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Browser extension did not answer ${method} in ${timeoutMs}ms.`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
    });
    this.deliver(command);
    return promise;
  }

  private deliver(command: PendingCommand): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      this.sendJson(waiter.res, 200, command);
      return;
    }
    this.queue.push(command);
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      this.sendJson(waiter.res, 204, undefined);
    }
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Browser bridge closed."));
      this.pending.delete(id);
    }
    const server = this.server;
    this.server = undefined;
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        // The extension's long poll and fetch keep-alive sockets would
        // otherwise keep close() waiting until they time out.
        server.closeAllConnections();
      });
    }
  }

  private async ensureStarted(): Promise<void> {
    if (this.closed) throw new Error("Browser bridge is closed.");
    if (this.server) return;
    this.token = await loadOrCreateToken();
    const server = createServer((req, res) => this.handle(req, res));
    let lastError: unknown;
    for (let offset = 0; offset < PORT_TRIES; offset++) {
      const port = PORT_START + offset;
      try {
        await new Promise<void>((resolve, reject) => {
          const onError = (error: NodeJS.ErrnoException) => {
            server.off("listening", onListening);
            reject(error);
          };
          const onListening = () => {
            server.off("error", onError);
            resolve();
          };
          server.once("error", onError);
          server.once("listening", onListening);
          server.listen(port, "127.0.0.1");
        });
        this.server = server;
        this.port = (server.address() as AddressInfo).port;
        await writeBridgeInfo({ port: this.port, token: this.token });
        return;
      } catch (error) {
        lastError = error;
        if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") break;
      }
    }
    throw new Error(
      `Could not start the browser bridge: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const origin = req.headers.origin;
    res.setHeader("Access-Control-Allow-Origin", origin ?? "*");
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    if (!this.authorized(req)) {
      this.sendJson(res, 401, { error: "unauthorized" });
      return;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/info") {
      this.sendJson(res, 200, {
        ok: true,
        pending: this.queue.length,
        lastPollAt: this.lastPollAt,
        pollCount: this.pollCount,
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/next") {
      this.nextCommand(res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/result") {
      void this.readResult(req, res);
      return;
    }
    this.sendJson(res, 404, { error: "not found" });
  }

  private authorized(req: IncomingMessage): boolean {
    const header = req.headers.authorization;
    return typeof header === "string" && header === `Bearer ${this.token}`;
  }

  private nextCommand(res: ServerResponse): void {
    this.lastPollAt = Date.now();
    this.pollCount += 1;
    const command = this.queue.shift();
    if (command) {
      this.sendJson(res, 200, command);
      return;
    }
    const waiter: Waiter = {
      res,
      timer: setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        this.sendJson(res, 204, undefined);
      }, LONG_POLL_MS),
    };
    waiter.timer.unref?.();
    this.waiters.push(waiter);
  }

  private async readResult(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body) as { id?: unknown; result?: unknown; error?: unknown };
      if (typeof parsed.id !== "string") {
        this.sendJson(res, 400, { error: "missing id" });
        return;
      }
      const pending = this.pending.get(parsed.id);
      if (!pending) {
        this.sendJson(res, 404, { error: "unknown id" });
        return;
      }
      this.pending.delete(parsed.id);
      clearTimeout(pending.timer);
      if (typeof parsed.error === "string") {
        pending.reject(new Error(parsed.error));
      } else {
        pending.resolve(parsed.result);
      }
      this.sendJson(res, 200, { ok: true });
    } catch (error) {
      this.sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private sendJson(res: ServerResponse, status: number, body: unknown): void {
    if (res.writableEnded) return;
    if (body === undefined) {
      res.writeHead(status).end();
      return;
    }
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload),
    });
    res.end(payload);
  }
}

function bridgeFilePath(): string {
  return join(homedir(), ".lucky", TOKEN_FILE);
}

async function loadOrCreateToken(): Promise<string> {
  const path = bridgeFilePath();
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as { token?: unknown };
    if (typeof parsed.token === "string" && parsed.token.length >= 16) return parsed.token;
  } catch {
    // First run or unreadable: create a fresh token.
  }
  return randomBytes(24).toString("base64url");
}

async function writeBridgeInfo(info: BrowserBridgeInfo): Promise<void> {
  const dir = join(homedir(), ".lucky");
  await mkdir(dir, { recursive: true });
  const path = bridgeFilePath();
  await writeFile(path, `${JSON.stringify(info, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600).catch(() => {});
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

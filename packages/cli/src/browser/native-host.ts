/**
 * `lucky browser host` — the Chrome native messaging host.
 *
 * Chrome spawns this process when the Lucky extension calls `connectNative`.
 * It speaks length-prefixed JSON over stdin/stdout and, in parallel, listens on
 * a Unix socket for Lucky itself. Every MCP request from Lucky is forwarded to
 * the extension as a `tool_request`; every `tool_response` from the extension is
 * forwarded back to the MCP client. This is the same split Claude in Chrome
 * uses, and it keeps the browser in charge of executing page actions.
 *
 * The process owns no browser logic and accepts no method of its own: it is a
 * framed, authenticated-by-origin relay.
 */
import { chmod, mkdir, readdir, rmdir, unlink } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { hostname } from "node:os";
import { join } from "node:path";
import { browserBridgeDir, browserBridgeSocketPath, pidAlive } from "@luckycli/core";
import { CORE_VERSION } from "@luckycli/core";
import { encodeFrame, FrameDecoder } from "./frames.js";

const MAX_CLIENTS = 8;

interface NativeHostOptions {
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  /** Override for tests; defaults to the real bridge directory. */
  socketDir?: string;
  log?: (line: string) => void;
  version?: string;
}

interface ClientState {
  socket: Socket;
  decoder: FrameDecoder;
}

type Message = { type: string; [key: string]: unknown };

function isMessage(value: unknown): value is Message {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

export async function runBrowserNativeHost(options: NativeHostOptions = {}): Promise<void> {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const log = options.log ?? ((line: string) => process.stderr.write(`[lucky browser host] ${line}\n`));
  const socketDir = options.socketDir ?? browserBridgeDir();
  const version = options.version ?? CORE_VERSION;
  const socketPath = browserBridgeSocketPath(process.pid, socketDir);

  const clients = new Map<number, ClientState>();
  let nextClientId = 1;
  let closed = false;

  const write = (message: Message): void => {
    if (closed) return;
    try {
      stdout.write(encodeFrame(message));
    } catch (error) {
      log(`write failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const forwardToClients = (message: Message): void => {
    const { type: _type, ...payload } = message;
    const frame = encodeFrame(payload);
    for (const [id, client] of clients) {
      try {
        client.socket.write(frame);
      } catch (error) {
        log(`client ${id} write failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };

  const handleExtensionMessage = (message: Message): void => {
    switch (message.type) {
      case "ping":
        write({ type: "pong", timestamp: Date.now() });
        return;
      case "get_status":
        write({
          type: "status_response",
          native_host_version: version,
          computer_name: hostname(),
        });
        return;
      case "tool_response":
        forwardToClients(message);
        return;
      case "notification":
        forwardToClients(message);
        return;
      case "error":
        log(`extension error: ${String(message.error ?? "unknown")}`);
        return;
      default:
        log(`unknown message type: ${message.type}`);
        write({ type: "error", error: `Unknown message type: ${message.type}` });
    }
  };

  const handleClientMessage = (clientId: number, raw: unknown): void => {
    if (typeof raw !== "object" || raw === null) {
      log(`client ${clientId} sent a non-object message`);
      return;
    }
    const message = raw as Record<string, unknown>;
    const method = typeof message.method === "string" ? message.method : undefined;
    if (!method) {
      // A response from the MCP client (no method) is not part of this bridge.
      return;
    }
    const id = message.id;
    write({
      type: "tool_request",
      ...(id !== undefined ? { id } : {}),
      method,
      params: message.params ?? {},
    });
  };

  const server = createServer((socket) => {
    if (clients.size >= MAX_CLIENTS) {
      socket.destroy();
      return;
    }
    const id = nextClientId++;
    const state: ClientState = { socket, decoder: new FrameDecoder() };
    clients.set(id, state);
    log(`mcp client ${id} connected (${clients.size} total)`);
    write({ type: "mcp_connected" });
    socket.on("data", (chunk: Buffer) => {
      try {
        for (const message of state.decoder.push(chunk)) handleClientMessage(id, message);
      } catch (error) {
        log(`client ${id} frame error: ${error instanceof Error ? error.message : String(error)}`);
        socket.destroy();
      }
    });
    socket.on("error", (error) => log(`client ${id} error: ${error.message}`));
    socket.on("close", () => {
      clients.delete(id);
      log(`mcp client ${id} disconnected (${clients.size} remaining)`);
      write({ type: "mcp_disconnected" });
    });
  });

  await prepareSocketDir(socketDir, log);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  await chmod(socketPath, 0o600).catch(() => {});
  log(`listening on ${socketPath}`);

  const decoder = new FrameDecoder();
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const cleanup = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    for (const client of clients.values()) client.socket.destroy();
    clients.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await unlink(socketPath).catch(() => {});
    await rmdir(socketDir).catch(() => {});
    log("stopped");
    resolveDone();
  };

  stdin.on("data", (chunk: Buffer | string) => {
    try {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      for (const message of decoder.push(bytes)) {
        if (isMessage(message)) handleExtensionMessage(message);
        else log("extension sent a non-object message");
      }
    } catch (error) {
      log(`native frame error: ${error instanceof Error ? error.message : String(error)}`);
      void cleanup();
    }
  });
  stdin.on("end", () => void cleanup());
  stdin.on("close", () => void cleanup());
  stdin.on("error", () => void cleanup());

  await done;
}

async function prepareSocketDir(dir: string, log: (line: string) => void): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700).catch(() => {});
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".sock")) continue;
    const pid = Number.parseInt(entry.slice(0, -5), 10);
    if (!Number.isInteger(pid) || pidAlive(pid)) continue;
    await unlink(join(dir, entry)).catch(() => {});
    log(`removed stale socket for pid ${pid}`);
  }
}

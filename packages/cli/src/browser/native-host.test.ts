import { PassThrough } from "node:stream";
import { connect, type Socket } from "node:net";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runBrowserNativeHost } from "./native-host.js";
import { encodeFrame, FrameDecoder } from "./frames.js";

const temps: string[] = [];
const sockets: Socket[] = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "lucky-native-host-"));
  temps.push(dir);
  return dir;
}

async function waitFor<T>(fn: () => T | undefined, timeoutMs = 3000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = fn();
    if (value !== undefined) return value;
    if (Date.now() - started > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("runBrowserNativeHost", () => {
  it("answers ping/status and relays MCP frames in both directions", async () => {
    const dir = temp();
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const nativeMessages: any[] = [];
    const nativeDecoder = new FrameDecoder();
    stdout.on("data", (chunk: Buffer) => nativeMessages.push(...nativeDecoder.push(chunk)));

    const finished = runBrowserNativeHost({
      stdin,
      stdout,
      socketDir: dir,
      version: "test-version",
      log: () => {},
    });

    const socketPath = join(dir, `${process.pid}.sock`);
    await waitFor(() => (existsSync(socketPath) ? true : undefined));

    stdin.write(encodeFrame({ type: "ping" }));
    const pong = await waitFor(() => nativeMessages.find((m) => m.type === "pong"));
    expect(pong.timestamp).toBeTypeOf("number");

    stdin.write(encodeFrame({ type: "get_status" }));
    const status = await waitFor(() => nativeMessages.find((m) => m.type === "status_response"));
    expect(status.native_host_version).toBe("test-version");

    const client = connect(socketPath);
    sockets.push(client);
    const clientMessages: any[] = [];
    const clientDecoder = new FrameDecoder();
    client.on("data", (chunk: Buffer) => clientMessages.push(...clientDecoder.push(chunk)));
    await new Promise<void>((resolve, reject) => {
      client.once("connect", resolve);
      client.once("error", reject);
    });

    await waitFor(() => nativeMessages.find((m) => m.type === "mcp_connected"));

    client.write(encodeFrame({ jsonrpc: "2.0", id: 7, method: "tools/list", params: {} }));
    const request = await waitFor(() => nativeMessages.find((m) => m.type === "tool_request"));
    expect(request).toMatchObject({ id: 7, method: "tools/list" });

    stdin.write(
      encodeFrame({ type: "tool_response", id: 7, result: { tools: [{ name: "tabs_list" }] } }),
    );
    const response = await waitFor(() => clientMessages.find((m) => m.id === 7));
    expect(response).toEqual({ id: 7, result: { tools: [{ name: "tabs_list" }] } });
    expect(response.type).toBeUndefined();

    stdin.write(encodeFrame({ type: "notification", method: "tabs_changed", params: { tabId: 3 } }));
    const notification = await waitFor(() => clientMessages.find((m) => m.method === "tabs_changed"));
    expect(notification.params).toEqual({ tabId: 3 });

    stdin.end();
    await finished;
    expect(existsSync(socketPath)).toBe(false);
  });

  it("removes stale sockets for dead pids", async () => {
    const dir = temp();
    const stale = join(dir, "999999999.sock");
    writeFileSync(stale, "");
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    stdout.resume();
    const finished = runBrowserNativeHost({ stdin, stdout, socketDir: dir, log: () => {} });
    await waitFor(() => (existsSync(join(dir, `${process.pid}.sock`)) ? true : undefined));
    expect(existsSync(stale)).toBe(false);
    stdin.end();
    await finished;
  });
});

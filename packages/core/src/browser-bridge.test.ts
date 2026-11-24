import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  browserBridgeDir,
  browserBridgeSocketPath,
  discoverBrowserBridge,
  listBrowserBridgeSockets,
  pidAlive,
} from "./browser-bridge.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "lucky-bridge-discovery-"));
  temps.push(dir);
  return dir;
}

describe("browserBridgeDir", () => {
  it("uses the Claude-compatible naming", () => {
    expect(browserBridgeDir("alice", "/tmp")).toBe("/tmp/lucky-mcp-browser-bridge-alice");
    expect(browserBridgeSocketPath(123, "/tmp/x")).toBe("/tmp/x/123.sock");
  });
});

describe("pidAlive", () => {
  it("knows the current process and rejects impossible pids", () => {
    expect(pidAlive(process.pid)).toBe(true);
    expect(pidAlive(999_999_999)).toBe(false);
    expect(pidAlive(0)).toBe(false);
    expect(pidAlive(-1)).toBe(false);
  });
});

describe("listBrowserBridgeSockets", () => {
  it("returns live sockets newest first and ignores stale ones", () => {
    const dir = temp();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "999999999.sock"), "");
    writeFileSync(join(dir, "123.sock"), "");
    writeFileSync(join(dir, "456.sock"), "");
    writeFileSync(join(dir, "not-a-pid.sock"), "");
    writeFileSync(join(dir, "notes.txt"), "");

    const sockets = listBrowserBridgeSockets({
      dir,
      alive: (pid) => pid === 123 || pid === 456,
    });
    expect(sockets).toEqual([join(dir, "456.sock"), join(dir, "123.sock")]);
  });

  it("returns an empty list when the directory is missing", () => {
    expect(listBrowserBridgeSockets({ dir: join(temp(), "absent") })).toEqual([]);
  });
});

describe("discoverBrowserBridge", () => {
  it("returns the newest live socket or undefined", () => {
    const dir = temp();
    writeFileSync(join(dir, "111.sock"), "");
    expect(discoverBrowserBridge({ dir, alive: () => true })).toBe(join(dir, "111.sock"));
    expect(discoverBrowserBridge({ dir, alive: () => false })).toBeUndefined();
  });
});

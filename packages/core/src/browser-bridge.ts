/**
 * Discovery of the Lucky browser bridge.
 *
 * Chrome spawns one native host per extension connection; each host listens on
 * `<tmp>/lucky-mcp-browser-bridge-<user>/<pid>.sock` (the same convention Claude
 * in Chrome uses). Lucky scans that directory, ignores sockets whose PID is
 * gone, and connects to the first live one as an MCP client.
 */
import { readdirSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";

/** Directory holding the per-process bridge sockets. */
export function browserBridgeDir(
  username = safeUsername(),
  tmp = "/tmp",
): string {
  return join(tmp, `lucky-mcp-browser-bridge-${username}`);
}

/** Socket path the native host should listen on. */
export function browserBridgeSocketPath(
  pid = process.pid,
  dir = browserBridgeDir(),
): string {
  return join(dir, `${pid}.sock`);
}

export interface DiscoverBrowserBridgeOptions {
  /** Override the directory (tests); defaults to the real tmp dir. */
  dir?: string;
  /** Liveness probe, injectable for tests. */
  alive?: (pid: number) => boolean;
}

/** True when the process exists (EPERM means it exists but is another user). */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Live bridge sockets, newest PID first. */
export function listBrowserBridgeSockets(
  options: DiscoverBrowserBridgeOptions = {},
): string[] {
  const dir = options.dir ?? browserBridgeDir();
  const alive = options.alive ?? pidAlive;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith(".sock"))
    .map((name) => ({ name, pid: Number.parseInt(name.slice(0, -5), 10) }))
    .filter((entry) => Number.isInteger(entry.pid) && alive(entry.pid))
    .sort((a, b) => b.pid - a.pid)
    .map((entry) => join(dir, entry.name));
}

/** The newest live bridge socket, or undefined when no native host is running. */
export function discoverBrowserBridge(
  options: DiscoverBrowserBridgeOptions = {},
): string | undefined {
  return listBrowserBridgeSockets(options)[0];
}

function safeUsername(): string {
  try {
    return userInfo().username || "default";
  } catch {
    return process.env.USER || process.env.USERNAME || "default";
  }
}

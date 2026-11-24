/**
 * The project directory the browser side panel chats about.
 *
 * Chrome spawns the native host with the wrapper's directory as cwd, so the
 * host cannot know which project the user is in. The TUI writes its cwd here on
 * startup; the panel can also change it explicitly.
 */
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface BrowserChatSession {
  cwd: string;
  updatedAt: string;
}

export function browserChatFile(home = homedir()): string {
  return join(home, ".luckycli", "browser-chat.json");
}

export function readBrowserChatCwd(home = homedir()): string {
  try {
    const raw = JSON.parse(readFileSync(browserChatFile(home), "utf8")) as { cwd?: unknown };
    if (typeof raw.cwd === "string" && raw.cwd.startsWith("/")) return raw.cwd;
  } catch {
    // missing or unreadable: fall back to the home directory
  }
  return home;
}

export async function writeBrowserChatCwd(cwd: string, home = homedir()): Promise<void> {
  const path = browserChatFile(home);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700).catch(() => {});
  const session: BrowserChatSession = { cwd, updatedAt: new Date().toISOString() };
  await writeFile(path, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600).catch(() => {});
}

export async function readBrowserChatCwdAsync(home = homedir()): Promise<string> {
  try {
    const parsed = JSON.parse(await readFile(browserChatFile(home), "utf8")) as { cwd?: unknown };
    if (typeof parsed.cwd === "string" && parsed.cwd.startsWith("/")) return parsed.cwd;
  } catch {
    // fall through
  }
  return home;
}

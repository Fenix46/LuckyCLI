/**
 * `lucky browser install|status|uninstall`: manage the native messaging host
 * that lets Chrome start the Lucky browser bridge automatically.
 */
import {
  browserStatus,
  installNativeHost,
  uninstallNativeHost,
  type BrowserStatus,
  type InstalledHost,
} from "./install.js";

export interface BrowserCommandIO {
  out?: (line: string) => void;
  err?: (line: string) => void;
  install?: typeof installNativeHost;
  status?: typeof browserStatus;
  uninstall?: typeof uninstallNativeHost;
}

const USAGE = `Usage:
  lucky browser install     install the native host for Chrome (and other Chromium browsers)
  lucky browser status      show the host, the browser manifests and live bridge sockets
  lucky browser uninstall   remove the manifests and the wrapper

After installing, load the extension once from chrome://extensions and reload it.`;

function statusLines(
  result: Awaited<ReturnType<typeof browserStatus>>,
): string[] {
  const lines: string[] = [];
  lines.push(`wrapper: ${result.wrapperPresent ? "installed" : "missing"}  ${result.wrapper}`);
  lines.push(
    result.sockets.length > 0
      ? `bridge: ${result.sockets.length} live socket${result.sockets.length === 1 ? "" : "s"} (${result.sockets[0]})`
      : "bridge: no native host running (open the extension or reload it)",
  );
  for (const host of result.hosts) {
    if (!host.installed && !host.manifestPresent) continue;
    lines.push(
      `${host.target.name.padEnd(16)} ${host.manifestPresent ? "manifest ok" : "manifest missing"}`,
    );
  }
  return lines;
}

export async function runBrowserCommand(
  args: string[],
  io: BrowserCommandIO = {},
): Promise<number> {
  const out = io.out ?? ((line: string) => process.stdout.write(`${line}\n`));
  const err = io.err ?? ((line: string) => process.stderr.write(`${line}\n`));
  const sub = args[0] ?? "status";

  if (sub === "install") {
    const install = io.install ?? installNativeHost;
    let installed: InstalledHost[];
    try {
      installed = await install();
    } catch (error) {
      err(error instanceof Error ? error.message : String(error));
      return 1;
    }
    if (installed.length === 0) {
      err("No supported Chromium browser detected. Install Chrome, Brave, Edge, Chromium, Vivaldi or Opera first.");
      return 1;
    }
    out(`Native host installed for ${installed.length} browser${installed.length === 1 ? "" : "s"}:`);
    for (const entry of installed) out(`  ${entry.browser}: ${entry.manifest}`);
    out("");
    out("Next: chrome://extensions -> enable Developer mode -> Load unpacked -> reload the Lucky extension.");
    return 0;
  }

  if (sub === "status") {
    const status = io.status ?? browserStatus;
    try {
      statusLines(await status()).forEach(out);
    } catch (error) {
      err(error instanceof Error ? error.message : String(error));
      return 1;
    }
    return 0;
  }

  if (sub === "uninstall") {
    const uninstall = io.uninstall ?? uninstallNativeHost;
    try {
      const removed = await uninstall();
      out(
        removed.length > 0
          ? `Removed ${removed.length} file${removed.length === 1 ? "" : "s"}:`
          : "Nothing to remove.",
      );
      for (const path of removed) out(`  ${path}`);
    } catch (error) {
      err(error instanceof Error ? error.message : String(error));
      return 1;
    }
    return 0;
  }

  err(USAGE);
  return 1;
}

export type { BrowserStatus };

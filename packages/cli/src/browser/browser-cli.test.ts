import { describe, expect, it, vi } from "vitest";
import { runBrowserCommand, type BrowserCommandIO } from "./browser-cli.js";
import type { InstalledHost } from "./install.js";

function harness(overrides: Partial<BrowserCommandIO> = {}): {
  io: BrowserCommandIO;
  out: string[];
  err: string[];
} {
  const out: string[] = [];
  const err: string[] = [];
  const io: BrowserCommandIO = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    ...overrides,
  };
  return { io, out, err };
}

const installed: InstalledHost[] = [
  { browser: "Google Chrome", manifest: "/home/u/Library/.../com.luckycli.browser_extension.json" },
];

describe("runBrowserCommand", () => {
  it("installs and prints the next step", async () => {
    const { io, out } = harness({ install: vi.fn(async () => installed) });
    expect(await runBrowserCommand(["install"], io)).toBe(0);
    expect(out.join("\n")).toContain("Google Chrome");
    expect(out.join("\n")).toContain("chrome://extensions");
  });

  it("fails when no browser is detected", async () => {
    const { io, err } = harness({ install: vi.fn(async () => []) });
    expect(await runBrowserCommand(["install"], io)).toBe(1);
    expect(err[0]).toContain("No supported Chromium browser");
  });

  it("prints status lines", async () => {
    const status = {
      wrapper: "/home/u/.luckycli/chrome-native-host",
      wrapperPresent: true,
      sockets: ["/tmp/lucky-mcp-browser-bridge-u/123.sock"],
      hosts: [
        {
          target: { id: "chrome", name: "Google Chrome", dir: "/x", markers: [] },
          installed: true,
          manifestPresent: true,
          wrapperPresent: true,
        },
      ],
    };
    const { io, out } = harness({
      status: vi.fn(async () => status) as unknown as BrowserCommandIO["status"],
    });
    expect(await runBrowserCommand(["status"], io)).toBe(0);
    expect(out.join("\n")).toContain("wrapper: installed");
    expect(out.join("\n")).toContain("bridge: 1 live socket");
    expect(out.join("\n")).toContain("Google Chrome");
  });

  it("uninstalls and reports the removed files", async () => {
    const { io, out } = harness({ uninstall: vi.fn(async () => ["/a", "/b"]) });
    expect(await runBrowserCommand(["uninstall"], io)).toBe(0);
    expect(out).toEqual(["Removed 2 files:", "  /a", "  /b"]);
  });

  it("prints usage for an unknown subcommand", async () => {
    const { io, err } = harness();
    expect(await runBrowserCommand(["wat"], io)).toBe(1);
    expect(err[0]).toContain("Usage:");
  });
});

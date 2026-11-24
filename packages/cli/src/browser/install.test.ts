import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EXTENSION_ID,
  NATIVE_HOST_NAME,
  browserStatus,
  browserTargets,
  hostManifest,
  installNativeHost,
  uninstallNativeHost,
  wrapperPath,
  wrapperScript,
} from "./install.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "lucky-browser-install-"));
  temps.push(dir);
  return dir;
}

describe("wrapper and manifest", () => {
  it("builds a shell wrapper with quoted paths", () => {
    const script = wrapperScript("/opt/Lucky App/lucky", "/opt/Lucky App/dist/index.js");
    expect(script).toContain('exec "/opt/Lucky App/lucky" "/opt/Lucky App/dist/index.js" browser host');
  });

  it("builds a manifest with the fixed extension origin", () => {
    const manifest = JSON.parse(hostManifest("/home/u/.luckycli/chrome-native-host")) as {
      name: string;
      path: string;
      type: string;
      allowed_origins: string[];
    };
    expect(manifest).toEqual({
      name: NATIVE_HOST_NAME,
      description: "Lucky browser bridge native host",
      path: "/home/u/.luckycli/chrome-native-host",
      type: "stdio",
      allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
    });
  });
});

describe("browserTargets", () => {
  it("includes the Chromium family on macOS and Linux", () => {
    const mac = browserTargets("darwin", "/Users/u").map((target) => target.id);
    expect(mac).toContain("chrome");
    expect(mac).toContain("brave");
    expect(mac).toContain("arc");
    expect(mac).toContain("edge");

    const linux = browserTargets("linux", "/home/u").map((target) => target.id);
    expect(linux).toEqual(["chrome", "brave", "chromium", "edge", "vivaldi", "opera"]);
  });
});

describe("installNativeHost", () => {
  it("writes the wrapper and only the detected browser manifests", async () => {
    const home = temp();
    const installed = await installNativeHost({
      home,
      platform: "linux",
      execPath: "/usr/local/bin/lucky",
      entryPath: "/usr/local/bin/lucky",
      exists: async (path) => path === "/usr/bin/google-chrome" || path === "/usr/bin/brave-browser",
    });

    expect(installed.map((entry) => entry.browser)).toEqual(["Google Chrome", "Brave"]);
    const wrapper = wrapperPath(home);
    expect(readFileSync(wrapper, "utf8")).toContain('exec "/usr/local/bin/lucky" browser host');
    expect(statSync(wrapper).mode & 0o777).toBe(0o700);
    expect(readFileSync(installed[0]!.manifest, "utf8")).toContain(EXTENSION_ID);
  });

  it("does not add a script entry for a compiled Lucky binary", async () => {
    const home = temp();
    await installNativeHost({
      home,
      platform: "linux",
      execPath: "/opt/lucky",
      exists: async (path) => path === "/usr/bin/google-chrome",
    });
    expect(readFileSync(wrapperPath(home), "utf8")).toContain('exec "/opt/lucky" browser host');
  });
});

describe("browserStatus / uninstall", () => {
  it("reports and removes exactly what was installed", async () => {
    const home = temp();
    const options = {
      home,
      platform: "linux" as const,
      execPath: "/usr/local/bin/lucky",
      entryPath: "/usr/local/bin/lucky",
      exists: async (path: string) => path === "/usr/bin/google-chrome",
    };
    await installNativeHost(options);

    const status = await browserStatus({ ...options, exists: async (path) => path.includes("chrome") });
    expect(status.wrapperPresent).toBe(true);
    expect(status.hosts.find((host) => host.target.id === "chrome")?.manifestPresent).toBe(true);

    const removed = await uninstallNativeHost(options);
    expect(removed.some((path) => path.endsWith(`${NATIVE_HOST_NAME}.json`))).toBe(true);
    expect(removed).toContain(wrapperPath(home));
    await expect(() => statSync(wrapperPath(home))).toThrow();
  });
});

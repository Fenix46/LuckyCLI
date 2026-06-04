import { describe, expect, it } from "vitest";
import {
  assetName,
  buildAssetUrls,
  canSelfUpdate,
  isCompiledBinary,
  parseSha256Sums,
  resolvePlatform,
} from "./self-replace.js";

describe("asset naming", () => {
  it("names unix assets by os and arch", () => {
    expect(assetName("darwin", "arm64")).toBe("lucky-darwin-arm64");
    expect(assetName("darwin", "x64")).toBe("lucky-darwin-x64");
    expect(assetName("linux", "x64")).toBe("lucky-linux-x64");
    expect(assetName("linux", "arm64")).toBe("lucky-linux-arm64");
  });

  it("always uses the x64 .exe on windows", () => {
    expect(assetName("windows", "x64")).toBe("lucky-windows-x64.exe");
    expect(assetName("windows", "arm64")).toBe("lucky-windows-x64.exe");
  });
});

describe("resolvePlatform", () => {
  it("maps node platform/arch onto the supported matrix", () => {
    expect(resolvePlatform("darwin", "arm64")).toEqual({ os: "darwin", arch: "arm64" });
    expect(resolvePlatform("linux", "x64")).toEqual({ os: "linux", arch: "x64" });
    expect(resolvePlatform("win32", "x64")).toEqual({ os: "windows", arch: "x64" });
  });

  it("falls back to x64 for windows arm64 (no native asset)", () => {
    expect(resolvePlatform("win32", "arm64")).toEqual({ os: "windows", arch: "x64" });
  });

  it("throws on unsupported platform or arch", () => {
    expect(() => resolvePlatform("freebsd" as NodeJS.Platform, "x64")).toThrow(/Unsupported operating system/);
    expect(() => resolvePlatform("linux", "mips")).toThrow(/Unsupported architecture/);
  });
});

describe("buildAssetUrls", () => {
  it("targets the rolling latest release", () => {
    const urls = buildAssetUrls("latest", "darwin", "arm64");
    expect(urls.asset).toBe("lucky-darwin-arm64");
    expect(urls.assetUrl).toBe(
      "https://github.com/Fenix46/LuckyCLI/releases/latest/download/lucky-darwin-arm64",
    );
    expect(urls.checksumsUrl).toBe(
      "https://github.com/Fenix46/LuckyCLI/releases/latest/download/SHA256SUMS",
    );
  });

  it("targets a pinned version tag", () => {
    const urls = buildAssetUrls("v0.2.2", "linux", "x64");
    expect(urls.assetUrl).toBe(
      "https://github.com/Fenix46/LuckyCLI/releases/download/v0.2.2/lucky-linux-x64",
    );
    expect(urls.checksumsUrl).toBe(
      "https://github.com/Fenix46/LuckyCLI/releases/download/v0.2.2/SHA256SUMS",
    );
  });
});

describe("parseSha256Sums", () => {
  const body = [
    "aaaa1111  lucky-darwin-arm64",
    "bbbb2222  lucky-linux-x64",
    "",
    "CCCC3333   lucky-windows-x64.exe",
  ].join("\n");

  it("finds the hex for an asset (case-insensitive, extra whitespace)", () => {
    expect(parseSha256Sums(body, "lucky-darwin-arm64")).toBe("aaaa1111");
    expect(parseSha256Sums(body, "lucky-windows-x64.exe")).toBe("cccc3333");
  });

  it("returns undefined for a missing asset", () => {
    expect(parseSha256Sums(body, "lucky-linux-arm64")).toBeUndefined();
  });

  it("ignores blank lines and a trailing newline", () => {
    expect(parseSha256Sums(`${body}\n`, "lucky-linux-x64")).toBe("bbbb2222");
  });
});

describe("isCompiledBinary", () => {
  it("is true for a bun-run lucky binary", () => {
    expect(isCompiledBinary({ execPath: "/usr/local/bin/lucky", bunVersion: "1.1.0" })).toBe(true);
    expect(isCompiledBinary({ execPath: "C:\\x\\lucky.exe", bunVersion: "1.1.0" })).toBe(true);
    expect(isCompiledBinary({ execPath: "/tmp/lucky-darwin-arm64", bunVersion: "1.1.0" })).toBe(true);
  });

  it("is false in a dev runtime (node/bun launcher, or no bun)", () => {
    expect(isCompiledBinary({ execPath: "/usr/bin/node", bunVersion: "1.1.0" })).toBe(false);
    expect(isCompiledBinary({ execPath: "/usr/bin/bun", bunVersion: "1.1.0" })).toBe(false);
    expect(isCompiledBinary({ execPath: "/usr/local/bin/lucky", bunVersion: undefined })).toBe(false);
  });
});

describe("canSelfUpdate", () => {
  it("refuses in a dev runtime", () => {
    const cap = canSelfUpdate({
      execPath: "/usr/bin/node",
      isCompiledBinary: false,
      isDirWritable: () => true,
    });
    expect(cap).toMatchObject({ ok: false, reason: "dev-runtime" });
  });

  it("refuses when the install dir is not writable", () => {
    const cap = canSelfUpdate({
      execPath: "/opt/lucky/lucky",
      isCompiledBinary: true,
      isDirWritable: () => false,
    });
    expect(cap).toMatchObject({ ok: false, reason: "not-writable", targetDir: "/opt/lucky" });
  });

  it("allows when binary + writable dir", () => {
    const cap = canSelfUpdate({
      execPath: "/home/me/.local/bin/lucky",
      isCompiledBinary: true,
      isDirWritable: () => true,
    });
    expect(cap).toEqual({
      ok: true,
      targetPath: "/home/me/.local/bin/lucky",
      targetDir: "/home/me/.local/bin",
    });
  });
});

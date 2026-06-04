import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupStaleBinary,
  downloadVerified,
  swapInPlaceUnix,
  swapInPlaceWindows,
} from "./self-replace.js";

const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

function fakeFetch(buf: Buffer, ok = true, status = 200): typeof fetch {
  return (async () =>
    ({
      ok,
      status,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    }) as Response) as unknown as typeof fetch;
}

describe("downloadVerified", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lucky-dl-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes a temp file in the target dir and returns it on checksum match", async () => {
    const payload = Buffer.from("new binary bytes");
    const tmp = await downloadVerified("http://x/asset", sha256(payload), dir, {
      fetchImpl: fakeFetch(payload),
    });
    expect(tmp.startsWith(dir)).toBe(true);
    expect(readFileSync(tmp)).toEqual(payload);
  });

  it("unlinks the temp file and throws on checksum mismatch", async () => {
    const payload = Buffer.from("tampered");
    await expect(
      downloadVerified("http://x/asset", "deadbeef", dir, { fetchImpl: fakeFetch(payload) }),
    ).rejects.toThrow(/Checksum mismatch/);
    // no leftover temp files in the dir
    expect(existsSync(join(dir, ".lucky.download"))).toBe(false);
  });

  it("throws on a non-ok response", async () => {
    await expect(
      downloadVerified("http://x/asset", "abc", dir, { fetchImpl: fakeFetch(Buffer.from("x"), false, 404) }),
    ).rejects.toThrow(/Download failed \(404\)/);
  });
});

describe("swapInPlaceUnix", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lucky-swap-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("replaces the target file contents", () => {
    const target = join(dir, "lucky");
    const tmp = join(dir, ".lucky.download-1");
    writeFileSync(target, "old");
    writeFileSync(tmp, "new");
    swapInPlaceUnix(tmp, target);
    expect(readFileSync(target, "utf8")).toBe("new");
    expect(existsSync(tmp)).toBe(false);
  });
});

describe("swapInPlaceWindows", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lucky-swapwin-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("moves the old binary aside and swaps the new one in", () => {
    const target = join(dir, "lucky.exe");
    const tmp = join(dir, ".lucky.download-1");
    writeFileSync(target, "old");
    writeFileSync(tmp, "new");
    swapInPlaceWindows(tmp, target);
    expect(readFileSync(target, "utf8")).toBe("new");
    // the old binary is parked at <target>.old for cleanup on next launch
    expect(readFileSync(`${target}.old`, "utf8")).toBe("old");
  });

  it("cleanupStaleBinary removes the parked .old file", () => {
    const target = join(dir, "lucky.exe");
    writeFileSync(`${target}.old`, "stale");
    cleanupStaleBinary(target);
    expect(existsSync(`${target}.old`)).toBe(false);
  });
});

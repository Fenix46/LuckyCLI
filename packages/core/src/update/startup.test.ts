import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StoredConfig } from "../config/store.js";
import { applyStagedUpdateIfAny } from "./startup.js";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function fakeStore(initial: StoredConfig) {
  let cfg = initial;
  return {
    loadConfig: () => cfg,
    saveConfig: (c: StoredConfig) => {
      cfg = c;
    },
    get current() {
      return cfg;
    },
  };
}

describe("applyStagedUpdateIfAny", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lucky-startup-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("does nothing when no update is staged", () => {
    const store = fakeStore({});
    const res = applyStagedUpdateIfAny({
      execPath: join(dir, "lucky"),
      loadConfig: store.loadConfig,
      saveConfig: store.saveConfig,
    });
    expect(res).toEqual({ swapped: false });
  });

  it("swaps in a staged binary that matches its checksum and clears the record", () => {
    const target = join(dir, "lucky");
    const staged = join(dir, ".lucky.staged");
    writeFileSync(target, "old");
    writeFileSync(staged, "new");

    const store = fakeStore({
      update: { staged: { version: "v0.3.0", path: staged, sha256: sha256("new"), stagedAt: 1 } },
    });

    const res = applyStagedUpdateIfAny({
      execPath: target,
      platform: "linux",
      loadConfig: store.loadConfig,
      saveConfig: store.saveConfig,
    });

    expect(res).toEqual({ swapped: true, version: "v0.3.0" });
    expect(readFileSync(target, "utf8")).toBe("new");
    expect(store.current.update?.staged).toBeUndefined();
  });

  it("refuses and clears a staged binary that fails its checksum", () => {
    const target = join(dir, "lucky");
    const staged = join(dir, ".lucky.staged");
    writeFileSync(target, "old");
    writeFileSync(staged, "tampered");

    const store = fakeStore({
      update: { staged: { version: "v0.3.0", path: staged, sha256: sha256("expected"), stagedAt: 1 } },
    });

    const res = applyStagedUpdateIfAny({
      execPath: target,
      platform: "linux",
      loadConfig: store.loadConfig,
      saveConfig: store.saveConfig,
    });

    expect(res.swapped).toBe(false);
    expect(res.error).toMatch(/checksum/);
    expect(readFileSync(target, "utf8")).toBe("old"); // not replaced
    expect(store.current.update?.staged).toBeUndefined(); // record cleared
  });

  it("clears a staged record whose file has gone missing", () => {
    const store = fakeStore({
      update: { staged: { version: "v0.3.0", path: join(dir, "gone"), sha256: "x", stagedAt: 1 } },
    });
    const res = applyStagedUpdateIfAny({
      execPath: join(dir, "lucky"),
      loadConfig: store.loadConfig,
      saveConfig: store.saveConfig,
    });
    expect(res.swapped).toBe(false);
    expect(store.current.update?.staged).toBeUndefined();
  });

  it("removes a leftover .old binary from a prior windows swap", () => {
    const target = join(dir, "lucky.exe");
    writeFileSync(target, "current");
    writeFileSync(`${target}.old`, "stale");
    const store = fakeStore({});

    applyStagedUpdateIfAny({
      execPath: target,
      loadConfig: store.loadConfig,
      saveConfig: store.saveConfig,
    });

    expect(existsSync(`${target}.old`)).toBe(false);
  });
});

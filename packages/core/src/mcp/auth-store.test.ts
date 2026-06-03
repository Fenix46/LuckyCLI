import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearMcpAuthEntry,
  getMcpAuthEntry,
  loadMcpAuthStore,
  updateMcpAuthEntry,
} from "./auth-store.js";

const tmpDirs: string[] = [];

function tempStorePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "lucky-mcp-auth-"));
  tmpDirs.push(dir);
  return join(dir, "mcp-auth.json");
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("mcp auth store", () => {
  it("returns an empty entry for an unknown server", () => {
    const path = tempStorePath();
    expect(loadMcpAuthStore(path)).toEqual({ servers: {} });
    expect(getMcpAuthEntry("nope", path)).toEqual({});
  });

  it("merges partial updates into a server's entry", () => {
    const path = tempStorePath();
    updateMcpAuthEntry("docs", { codeVerifier: "verifier-1" }, path);
    updateMcpAuthEntry(
      "docs",
      { tokens: { access_token: "tok", token_type: "Bearer" } },
      path,
    );

    const entry = getMcpAuthEntry("docs", path);
    expect(entry.codeVerifier).toBe("verifier-1");
    expect(entry.tokens?.access_token).toBe("tok");
  });

  it("clears a server's entry on logout", () => {
    const path = tempStorePath();
    updateMcpAuthEntry("docs", { tokens: { access_token: "tok", token_type: "Bearer" } }, path);
    clearMcpAuthEntry("docs", path);
    expect(getMcpAuthEntry("docs", path)).toEqual({});
  });

  it.runIf(platform() !== "win32")("writes the token file with 0600 permissions", () => {
    const path = tempStorePath();
    updateMcpAuthEntry("docs", { tokens: { access_token: "secret", token_type: "Bearer" } }, path);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});

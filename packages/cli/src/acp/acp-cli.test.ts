import { describe, expect, it, vi } from "vitest";
import type { ResolvedConfig } from "@luckycli/core";
import { resolveAcpConfig, runAcpCommand } from "./acp-cli.js";
import { AUTH_GUIDANCE } from "./server.js";

function fakeConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    provider: "claude",
    model: "claude-sonnet-4-6",
    system: "sys",
    credentials: { kind: "api-key", apiKey: "sk-test" } as ResolvedConfig["credentials"],
    mcp: {},
    permissions: {},
    needsSetup: false,
    ...overrides,
  };
}

describe("resolveAcpConfig", () => {
  it("returns the config when provider, model and credentials are present", () => {
    const result = resolveAcpConfig({}, () => fakeConfig());
    expect(result).toEqual({ ok: true, config: fakeConfig() });
  });

  it("refuses with the login guidance when setup is needed", () => {
    const result = resolveAcpConfig(
      {},
      () => fakeConfig({ needsSetup: true, credentials: undefined }),
    );
    expect(result).toEqual({ ok: false, reason: AUTH_GUIDANCE });
  });

  it("forwards -p/-m flags to the resolver", () => {
    const resolve = vi.fn(() => fakeConfig());
    resolveAcpConfig({ provider: "gemini", model: "gemini-2.5-pro" }, resolve);
    expect(resolve).toHaveBeenCalledWith({ provider: "gemini", model: "gemini-2.5-pro" });
  });

  it("surfaces resolver errors (e.g. unknown provider id) as the reason", () => {
    const result = resolveAcpConfig({ provider: "nope" }, () => {
      throw new Error('Unknown provider "nope"');
    });
    expect(result).toEqual({ ok: false, reason: 'Unknown provider "nope"' });
  });
});

describe("runAcpCommand", () => {
  it("prints usage on -h without serving", async () => {
    const lines: string[] = [];
    const serve = vi.fn(async () => {});
    const code = await runAcpCommand(["-h"], { err: (l) => lines.push(l), serve });
    expect(code).toBe(0);
    expect(serve).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("Usage: lucky acp");
  });

  it("rejects unknown flags with usage and exit code 1", async () => {
    const lines: string[] = [];
    const serve = vi.fn(async () => {});
    const code = await runAcpCommand(["--bogus"], { err: (l) => lines.push(l), serve });
    expect(code).toBe(1);
    expect(serve).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("Usage: lucky acp");
  });

  // The command resolves from the real stored config here, which in a test
  // environment may or may not be set up: both outcomes are valid. What must
  // hold is the contract — either it serves (code 0, one stderr banner) or it
  // refuses cleanly (code 1, a reason, and serve never called).
  it("either serves with a banner or refuses cleanly, never both", async () => {
    const lines: string[] = [];
    const serve = vi.fn(async () => {});
    const code = await runAcpCommand([], { err: (l) => lines.push(l), serve });
    if (code === 0) {
      expect(serve).toHaveBeenCalledOnce();
      expect(lines.some((l) => l.includes("serving"))).toBe(true);
    } else {
      expect(serve).not.toHaveBeenCalled();
      expect(lines.some((l) => l.includes("lucky acp:"))).toBe(true);
    }
  });
});

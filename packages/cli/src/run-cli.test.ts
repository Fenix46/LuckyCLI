import { describe, expect, it, vi } from "vitest";
import type { Agent, AgentEvent, ResolvedConfig } from "@luckycli/core";
import { runCommand } from "./run-cli.js";

const config: ResolvedConfig = {
  provider: "ollama",
  model: "llama3",
  credentials: { type: "ollama", baseUrl: "http://127.0.0.1:11434" },
  system: "system",
  mcp: {},
  permissions: {},
  needsSetup: false,
};

function agent(events: AgentEvent[]): Agent {
  return { send: async function* () { yield* events; } } as unknown as Agent;
}

describe("runCommand", () => {
  it("runs an inline prompt and writes model text only to stdout", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const build = vi.fn(() => agent([{ type: "text", delta: "hello" }, { type: "turn_end" }]));
    const code = await runCommand(["--non-interactive", "say", "hello"], {
      out: (text) => out.push(text), err: (text) => err.push(text), resolve: () => config, build,
    });
    expect(code).toBe(0);
    expect(out).toEqual(["hello"]);
    expect(err).toEqual([]);
    expect(build).toHaveBeenCalledWith(config);
  });

  it("reads stdin and returns setup and provider failure codes", async () => {
    const out: string[] = [];
    const err: string[] = [];
    await expect(runCommand([], { stdin: async () => "from stdin", out: (text) => out.push(text), err: (text) => err.push(text), resolve: () => config, build: () => agent([{ type: "text", delta: "ok" }]) })).resolves.toBe(0);
    const missing = { ...config, provider: undefined, model: undefined, credentials: undefined, needsSetup: true };
    await expect(runCommand(["prompt"], { err: (text) => err.push(text), resolve: () => missing })).resolves.toBe(3);
  });

  it("keeps provider and tool errors on stderr and maps cancellation", async () => {
    const err: string[] = [];
    const failed = await runCommand(["prompt"], {
      err: (text) => err.push(text), resolve: () => config,
      build: () => agent([{ type: "error", message: "provider down" }]),
    });
    expect(failed).toBe(1);
    expect(err).toContain("provider down\n");
    const toolFailed = await runCommand(["prompt"], {
      err: (text) => err.push(text), resolve: () => config,
      build: () => agent([{ type: "tool_end", id: "1", name: "write_file", content: "approval denied", isError: true }]),
    });
    expect(toolFailed).toBe(1);
    const cancelled = await runCommand(["prompt"], {
      err: (text) => err.push(text), resolve: () => config,
      build: () => agent([{ type: "aborted" }]),
    });
    expect(cancelled).toBe(2);
  });
});

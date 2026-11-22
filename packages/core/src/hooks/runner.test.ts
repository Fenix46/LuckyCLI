import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHookRunner, parseHookStdout } from "./runner.js";

describe("createHookRunner", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "lucky-hooks-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("sends the payload on stdin and merges additional context", async () => {
    const script = join(cwd, "hook.mjs");
    await writeFile(
      script,
      `let raw="";process.stdin.on("data",(c)=>raw+=c);process.stdin.on("end",()=>{const input=JSON.parse(raw);console.log(JSON.stringify({additionalContext:"context for "+input.tool_name}));});`,
      "utf8",
    );
    const runner = createHookRunner(
      {
        PreToolUse: [
          { matcher: "^exec$", hooks: [{ type: "command", command: `node ${script}` }] },
        ],
      },
      { cwd },
    );

    const result = await runner.run("PreToolUse", {
      toolName: "exec",
      toolInput: { command: "ls" },
    });
    expect(result.blocked).toBe(false);
    expect(result.additionalContext).toBe("context for exec");
  });

  it("honors the matcher, including regexes", async () => {
    const runner = createHookRunner(
      {
        PreToolUse: [
          {
            matcher: "^write_",
            hooks: [{ type: "prompt", prompt: "write context" }],
          },
        ],
      },
      { cwd },
    );
    expect(
      (await runner.run("PreToolUse", { toolName: "write_file" })).additionalContext,
    ).toBe("write context");
    expect(
      (await runner.run("PreToolUse", { toolName: "read_file" })).additionalContext,
    ).toBeUndefined();
  });

  it("blocks on exit code 2 and on a JSON block decision", async () => {
    const exit2 = createHookRunner(
      {
        PreToolUse: [
          { hooks: [{ type: "command", command: "echo 'no writes today' >&2; exit 2" }] },
        ],
      },
      { cwd },
    );
    const blocked = await exit2.run("PreToolUse", { toolName: "write_file" });
    expect(blocked.blocked).toBe(true);
    expect(blocked.reason).toContain("no writes today");

    const jsonBlock = createHookRunner(
      {
        PreToolUse: [
          { hooks: [{ type: "command", command: `echo '{"decision":"block","reason":"policy"}'` }] },
        ],
      },
      { cwd },
    );
    const decision = await jsonBlock.run("PreToolUse", { toolName: "exec" });
    expect(decision.blocked).toBe(true);
    expect(decision.reason).toBe("policy");
  });

  it("accepts the Claude Code hookSpecificOutput envelope and input rewrites", async () => {
    const runner = createHookRunner(
      {
        PreToolUse: [
          {
            hooks: [
              {
                type: "command",
                command: `echo '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"nope","additionalContext":"be careful"},"updatedInput":{"command":"ls"}}'`,
              },
            ],
          },
        ],
      },
      { cwd },
    );
    const result = await runner.run("PreToolUse", { toolName: "exec", toolInput: { command: "rm -rf /" } });
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("nope");
    expect(result.additionalContext).toBe("be careful");
    expect(result.updatedInput).toEqual({ command: "ls" });
  });

  it("treats a failing command as a warning, not a block", async () => {
    const runner = createHookRunner(
      {
        SessionStart: [{ hooks: [{ type: "command", command: "echo broken >&2; exit 7" }] }],
      },
      { cwd },
    );
    const result = await runner.run("SessionStart", {});
    expect(result.blocked).toBe(false);
    expect(result.warnings[0]).toMatch(/exited with code 7/);
  });

  it("times a command out without blocking", async () => {
    const runner = createHookRunner(
      {
        SessionStart: [
          { hooks: [{ type: "command", command: "sleep 5", timeout: 0.05 }] },
        ],
      },
      { cwd },
    );
    const result = await runner.run("SessionStart", {});
    expect(result.blocked).toBe(false);
    expect(result.warnings[0]).toMatch(/timed out/);
  });

  it("posts HTTP hooks and reads a JSON response", async () => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const input = JSON.parse(body) as { hook_event_name: string };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ additionalContext: `seen ${input.hook_event_name}` }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const runner = createHookRunner(
        { UserPromptSubmit: [{ hooks: [{ type: "http", url: `http://127.0.0.1:${port}/hook` }] }] },
        { cwd },
      );
      const result = await runner.run("UserPromptSubmit", { prompt: "hi" });
      expect(result.additionalContext).toBe("seen UserPromptSubmit");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("is a no-op when disabled", async () => {
    const runner = createHookRunner(
      { SessionStart: [{ hooks: [{ type: "command", command: "exit 2" }] }] },
      { cwd, disabled: true },
    );
    expect(runner.has("SessionStart")).toBe(false);
    expect((await runner.run("SessionStart", {})).blocked).toBe(false);
  });
});

describe("parseHookStdout", () => {
  it("returns undefined for empty output and a warning for non-JSON", () => {
    expect(parseHookStdout("   ")).toBeUndefined();
    expect(parseHookStdout("hello")?.warning).toMatch(/non-JSON/);
  });

  it("maps continue=false to a block", () => {
    const parsed = parseHookStdout('{"continue":false,"stopReason":"halt"}');
    expect(parsed?.outcome.blocked).toBe(true);
    expect(parsed?.outcome.reason).toBe("halt");
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { ToolRegistry } from "../registry.js";
import { execTool } from "./exec.js";
import { processTool, resetBackgroundProcesses } from "./background.js";

const cwd = tmpdir();
const registry = new ToolRegistry().register(execTool).register(processTool);
const node = (script: string) => `node -e "${script}"`;

afterEach(async () => {
  await resetBackgroundProcesses();
});

describe("background processes", () => {
  it("starts a long-running command, reads new output, and stops it", async () => {
    const started = await registry.execute(
      "exec",
      { command: node("console.log('ready'); let n=0; setInterval(()=>console.log('tick '+(++n)), 150)"), background: true },
      { cwd },
    );
    expect(started.isError).toBeUndefined();
    expect(started.content).toMatch(/^\[bg\d+ · running · pid \d+/);
    expect(started.content).toContain("ready");
    const id = /\[(bg\d+)/.exec(started.content)?.[1] ?? "";

    const more = await registry.execute("process", { action: "output", id, waitMs: 2000 }, { cwd });
    const body = more.content.split("\n").slice(1).join("\n");
    expect(body).toContain("tick");
    expect(body).not.toContain("ready"); // only what's new

    const list = await registry.execute("process", { action: "list" }, { cwd });
    expect(list.content).toContain(`${id} · running`);

    const stopped = await registry.execute("process", { action: "stop", id }, { cwd });
    expect(stopped.content).toMatch(/stopped \(SIGTERM\)|exited/);
  });

  it("reports a command that finished or crashed during startup", async () => {
    const ok = await registry.execute("exec", { command: "echo done", background: true }, { cwd });
    expect(ok.content).toMatch(/exited 0/);
    expect(ok.content).toContain("done");
    expect(ok.content).not.toContain("Still running");

    const crash = await registry.execute("exec", { command: node("process.exit(3)"), background: true }, { cwd });
    expect(crash.isError).toBe(true);
    expect(crash.content).toContain("exited 3");
  });

  it("still refuses destructive commands", async () => {
    const r = await registry.execute("exec", { command: "rm -rf dist", background: true }, { cwd });
    expect(r.isError).toBe(true);
    expect(r.content).toContain("Refusing");
  });

  it("explains unknown ids", async () => {
    const r = await registry.execute("process", { action: "output", id: "bg999" }, { cwd });
    expect(r.isError).toBe(true);
    expect(r.content).toContain("Unknown process id");
  });
});

import { describe, expect, it, vi } from "vitest";
import type { Checkpoint } from "@luckycli/core";
import { RestoreConflictError } from "@luckycli/core";
import type { Item } from "../lib/items.js";
import type { Command, CommandContext } from "./types.js";
import { workflowCommands, type WorkflowCommandDeps } from "./workflow.js";

const checkpoint: Checkpoint = {
  id: "checkpoint-1",
  sessionId: "ses_abc_123",
  cwd: process.cwd(),
  title: "Before edit",
  createdAt: 100,
  status: "passed",
  files: [],
};

function harness(overrides: Partial<WorkflowCommandDeps> = {}) {
  const emitted: Item[] = [];
  const deps: WorkflowCommandDeps = {
    changedFiles: vi.fn(async () => ["src/index.ts"]),
    createSnapshot: vi.fn(async () => checkpoint),
    attachCheckpoint: vi.fn(() => true),
    listCheckpoints: vi.fn(() => [checkpoint]),
    getCheckpoint: vi.fn(() => checkpoint),
    removeCheckpoint: vi.fn(() => true),
    restoreSnapshot: vi.fn(async () => ({
      policy: "abort" as const,
      restored: ["src/index.ts"],
      unchanged: [],
      conflicts: [],
    })),
    ...overrides,
  };
  const ctx = {
    agent: {},
    meta: { provider: "claude", model: "claude-sonnet-4-6" },
    registry: [],
    emit: (...items: Item[]) => emitted.push(...items),
    setInput: vi.fn(),
    state: { activeThemeId: "lucky-dark", sessionId: "ses_abc_123", taskListId: "tasks", contextStatus: null },
    ui: {},
  } as unknown as CommandContext;
  const commands = workflowCommands(deps);
  const run = (name: string, args = "") => {
    const command = commands.find((entry: Command) => entry.name === name);
    if (!command) throw new Error(`missing command ${name}`);
    return command.run(args, ctx);
  };
  return { deps, emitted, run };
}

describe("workflow commands", () => {
  it("creates and attaches a checkpoint for changed files", async () => {
    const h = harness();
    await h.run("/checkpoint");
    expect(h.deps.changedFiles).toHaveBeenCalledWith(process.cwd());
    expect(h.deps.createSnapshot).toHaveBeenCalled();
    expect(h.deps.attachCheckpoint).toHaveBeenCalledWith("ses_abc_123", checkpoint);
    expect(h.emitted[0]).toMatchObject({ kind: "command", title: "Checkpoint" });
  });

  it("requires an explicit force confirmation for restore conflicts", async () => {
    const h = harness({
      restoreSnapshot: vi.fn(async () => {
        throw new RestoreConflictError([{ path: "src/index.ts", reason: "modified" }]);
      }),
    });
    await h.run("/restore", checkpoint.id);
    expect(h.emitted).toEqual([
      {
        kind: "command",
        title: "Restore blocked",
        rows: [
          { label: "conflicts", value: "src/index.ts (modified)" },
          { label: "confirm", value: "type /restore checkpoint-1 force" },
        ],
      },
    ]);
  });

  it("restores with force only when explicitly requested", async () => {
    const h = harness();
    await h.run("/restore", "checkpoint-1 force");
    expect(h.deps.restoreSnapshot).toHaveBeenCalledWith(process.cwd(), checkpoint, "force");
  });

  it("undoes the newest checkpoint and rejects unknown arguments", async () => {
    const h = harness();
    await h.run("/undo");
    expect(h.deps.restoreSnapshot).toHaveBeenCalledWith(process.cwd(), checkpoint, "abort");
    await h.run("/undo", "now");
    expect(h.emitted.at(-1)).toEqual({ kind: "error", text: "unknown command: /undo now. Try /help." });
  });

  it("lists checkpoints without exposing file contents", async () => {
    const h = harness();
    await h.run("/checkpoints");
    expect(h.emitted[0]).toMatchObject({ kind: "command", title: "Checkpoints" });
    expect(JSON.stringify(h.emitted[0])).not.toContain("before");
  });
});

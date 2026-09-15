import { describe, expect, it, vi } from "vitest";
import type { Checkpoint } from "@luckycli/core";
import type { VerificationResult } from "@luckycli/core";
import type { ReviewDiffResult, ReviewReport } from "@luckycli/core";
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
    runVerification: vi.fn(async () => ({
      id: "verification-1",
      sessionId: "ses_abc_123",
      cwd: process.cwd(),
      status: "passed" as const,
      startedAt: 1,
      finishedAt: 2,
      checks: [{
        id: "test",
        command: "npm test",
        cwd: process.cwd(),
        status: "passed" as const,
        exitCode: 0,
        output: "ok",
      }],
      files: [],
    } satisfies VerificationResult)),
    collectReviewDiff: vi.fn(async () => ({
      cwd: process.cwd(), source: "unstaged", truncated: false, totalChars: 1,
      files: [{ path: "src/app.ts", status: "modified" as const, source: "unstaged", patch: "@@ -1 +1 @@\n+change", binary: false, truncated: false, additions: 1, deletions: 0 }],
    } satisfies ReviewDiffResult)),
    review: vi.fn(async () => ({
      source: "unstaged", summary: "review summary", valid: true,
      findings: [{ id: "f1", severity: "low" as const, category: "style" as const, path: "src/app.ts", line: 1, title: "Style", explanation: "Minor", outOfDiff: false }],
    } satisfies ReviewReport)),
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

  it("runs verification and renders the check summary", async () => {
    const h = harness();
    await h.run("/verify");
    expect(h.deps.runVerification).toHaveBeenCalledWith(process.cwd(), [], { signal: expect.any(AbortSignal) });
    expect(h.emitted).toEqual([
      { kind: "command", title: "Verification", rows: [{ label: "status", value: "running" }] },
      {
        kind: "command",
        title: "Verification",
        rows: [
          { label: "status", value: "passed" },
          { label: "checks", value: "1" },
          { label: "test", value: "passed · exit 0" },
        ],
      },
    ]);
  });

  it("supports last and rejects last when no result exists", async () => {
    const empty = harness();
    await empty.run("/verify", "last");
    expect(empty.emitted).toEqual([{ kind: "error", text: "no verification result is available" }]);

    const h = harness();
    await h.run("/verify");
    h.emitted.length = 0;
    await h.run("/verify", "last");
    expect(h.emitted[0]).toMatchObject({ kind: "command", title: "Verification" });
  });

  it("cancels an active verification run", async () => {
    let resolveRun: ((result: VerificationResult) => void) | undefined;
    const h = harness({
      runVerification: vi.fn(() => new Promise<VerificationResult>((resolve) => { resolveRun = resolve; })),
    });
    const running = h.run("/verify");
    await vi.waitFor(() => expect(h.deps.runVerification).toHaveBeenCalled());
    await h.run("/verify", "cancel");
    expect(h.emitted.at(-1)).toEqual({ kind: "command", title: "Verification", rows: [{ label: "status", value: "cancelling" }] });
    resolveRun?.({ id: "verification-1", sessionId: "ses_abc_123", cwd: process.cwd(), status: "cancelled", startedAt: 1, checks: [], files: [] });
    await running;
  });

  it("reviews the current diff and orders findings by severity", async () => {
    const h = harness({
      review: vi.fn(async () => ({
        source: "head", summary: "two findings", valid: true,
        findings: [
          { id: "low", severity: "low" as const, category: "style" as const, path: "z.ts", title: "Low", explanation: "x", outOfDiff: false },
          { id: "high", severity: "high" as const, category: "bug" as const, path: "a.ts", line: 2, title: "High", explanation: "x", outOfDiff: false },
        ],
      } satisfies ReviewReport)),
    });
    await h.run("/review", "head");
    expect(h.deps.collectReviewDiff).toHaveBeenCalledWith({ cwd: process.cwd(), source: "head" });
    expect(h.emitted.at(-1)).toMatchObject({ rows: [
      { label: "status", value: "complete" },
      { label: "summary", value: "two findings" },
      { label: "high · bug · a.ts:2", value: "High" },
      { label: "low · style · z.ts", value: "Low" },
    ] });
  });

  it("reports an empty diff and review failures without breaking the command", async () => {
    const empty = harness({ collectReviewDiff: vi.fn(async () => ({ cwd: process.cwd(), source: "unstaged", truncated: false, totalChars: 0, files: [] })) });
    await empty.run("/review");
    expect(empty.emitted.at(-1)).toMatchObject({ rows: [{ label: "status", value: "no diff available" }] });
    const failed = harness({ review: vi.fn(async () => { throw new Error("provider down"); }) });
    await failed.run("/review");
    expect(failed.emitted.at(-1)).toEqual({ kind: "error", text: "provider down" });
  });

  it("cancels an active review", async () => {
    let resolveReview: ((result: ReviewReport) => void) | undefined;
    const h = harness({ review: vi.fn(() => new Promise<ReviewReport>((resolve) => { resolveReview = resolve; })) });
    const running = h.run("/review");
    await vi.waitFor(() => expect(h.deps.review).toHaveBeenCalled());
    await h.run("/review", "cancel");
    expect(h.emitted.at(-1)).toEqual({ kind: "command", title: "Review", rows: [{ label: "status", value: "cancelling" }] });
    resolveReview?.({ source: "unstaged", summary: "cancelled", valid: true, findings: [] });
    await running;
  });
});

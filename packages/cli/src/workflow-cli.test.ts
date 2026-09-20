import { describe, expect, it, vi } from "vitest";
import type { Agent, ReviewDiffResult, ReviewReport, ResolvedConfig, VerificationResult } from "@luckycli/core";
import { runReviewCommand, runVerifyCommand } from "./workflow-cli.js";

const passed: VerificationResult = {
  id: "verification-1", sessionId: "agent", cwd: "/repo", status: "passed", startedAt: 1, finishedAt: 2,
  checks: [{ id: "test", command: "npm test", cwd: "/repo", status: "passed", exitCode: 0, output: "ok" }], files: [],
};
const diff: ReviewDiffResult = {
  cwd: "/repo", source: "head", truncated: false, totalChars: 1,
  files: [{ path: "app.ts", status: "modified", source: "head", patch: "+ok", binary: false, truncated: false, additions: 1, deletions: 0 }],
};
const config: ResolvedConfig = { provider: "ollama", model: "test", credentials: { type: "ollama", baseUrl: "http://localhost" }, system: "sys", mcp: {}, permissions: {}, needsSetup: false };

describe("headless workflow commands", () => {
  it("serializes verification as JSON and JSONL", async () => {
    const json: string[] = [];
    await expect(runVerifyCommand(["--format", "json"], { out: (value) => json.push(value), verify: vi.fn(async () => passed) })).resolves.toBe(0);
    expect(JSON.parse(json.join(""))).toMatchObject({ version: 1, type: "result", command: "verify", status: "passed" });
    const jsonl: string[] = [];
    await runVerifyCommand(["--format", "jsonl"], { out: (value) => jsonl.push(value), verify: vi.fn(async () => passed) });
    expect(jsonl.map((line) => JSON.parse(line).type)).toEqual(["status", "result"]);
  });

  it("serializes review findings and empty diffs", async () => {
    const report: ReviewReport = { source: "head", summary: "one issue", valid: true, findings: [] };
    const out: string[] = [];
    await expect(runReviewCommand(["head", "--format", "json"], {
      out: (value) => out.push(value), collect: vi.fn(async () => diff), resolve: () => config,
      build: () => ({ send: async function* () { yield { type: "text", delta: JSON.stringify(report) }; } } as unknown as Agent),
    })).resolves.toBe(0);
    expect(JSON.parse(out.join(""))).toMatchObject({ version: 1, type: "result", command: "review", status: "passed" });
    const empty: string[] = [];
    await runReviewCommand(["--format", "json"], { out: (value) => empty.push(value), collect: vi.fn(async () => ({ ...diff, files: [] })) });
    expect(JSON.parse(empty.join(""))).toMatchObject({ type: "result", command: "review", status: "empty" });
  });

  it("keeps workflow failures machine-readable", async () => {
    const out: string[] = [];
    await expect(runVerifyCommand(["--format", "json"], { out: (value) => out.push(value), verify: vi.fn(async () => { throw new Error("check failed"); }) })).resolves.toBe(1);
    expect(JSON.parse(out.join(""))).toMatchObject({ version: 1, type: "error", command: "verify", message: "check failed" });
  });
});

import { describe, expect, it } from "vitest";
import {
  CheckpointSchema,
  parseCheckpoint,
  parseVerificationResult,
  VerificationResultSchema,
  WORKFLOW_STATUSES,
} from "./types.js";

const file = {
  path: "src/index.ts",
  existed: true,
  sha256: "a".repeat(64),
  size: 128,
};

describe("workflow contracts", () => {
  it("accepts and round-trips a checkpoint", () => {
    const checkpoint = {
      id: "checkpoint-1",
      sessionId: "session-1",
      cwd: "/project",
      title: "Before refactor",
      reason: "safe edit",
      createdAt: 1_700_000_000_000,
      status: "passed" as const,
      files: [file],
    };

    const parsed = parseCheckpoint(JSON.parse(JSON.stringify(checkpoint)));

    expect(parsed).toEqual(checkpoint);
  });

  it("accepts every documented workflow status", () => {
    for (const status of WORKFLOW_STATUSES) {
      const result = CheckpointSchema.safeParse({
        id: "checkpoint-1",
        sessionId: "session-1",
        cwd: "/project",
        title: "Checkpoint",
        createdAt: 0,
        status,
        files: [],
      });

      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid checkpoint data", () => {
    const result = CheckpointSchema.safeParse({
      id: "",
      sessionId: "session-1",
      cwd: "/project",
      title: "Checkpoint",
      createdAt: -1,
      status: "unknown",
      files: [{ ...file, sha256: "not-a-hash" }],
    });

    expect(result.success).toBe(false);
  });

  it("round-trips a verification result with an unfinished check", () => {
    const verification = {
      id: "verification-1",
      sessionId: "session-1",
      cwd: "/project",
      status: "running" as const,
      startedAt: 1_700_000_000_000,
      checks: [
        {
          id: "check-1",
          command: "npm test",
          cwd: "/project",
          status: "running" as const,
          output: "",
        },
      ],
      files: ["src/index.ts"],
    };

    const parsed = parseVerificationResult(
      JSON.parse(JSON.stringify(verification)),
    );

    expect(parsed).toEqual(verification);
    expect(VerificationResultSchema.safeParse(parsed).success).toBe(true);
  });

  it("rejects malformed verification checks", () => {
    const result = VerificationResultSchema.safeParse({
      id: "verification-1",
      sessionId: "session-1",
      cwd: "/project",
      status: "failed",
      startedAt: 0,
      checks: [{ id: "check-1", command: "npm test" }],
      files: [],
    });

    expect(result.success).toBe(false);
  });
});

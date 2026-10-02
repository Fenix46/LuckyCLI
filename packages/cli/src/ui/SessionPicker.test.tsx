import React from "react";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSessionId, saveSession, type Session } from "@luckycli/core";
import { renderToScreen, scanPositions } from "../vendor/ink/render-to-screen.js";
import { formatRelativeTime, SessionPicker } from "./SessionPicker.js";

const ORIGINAL_HOME = process.env.HOME;

function session(title: string, cwd: string | undefined, updatedAt: number): Session {
  return {
    id: createSessionId(),
    title,
    provider: "claude",
    model: "claude-sonnet-5",
    createdAt: updatedAt,
    updatedAt,
    ...(cwd ? { cwd } : {}),
    messages: [{ role: "user", content: [{ type: "text", text: title }] }],
  };
}

describe("SessionPicker", () => {
  let home: string;
  let projectA: string;
  let projectB: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "lucky-picker-home-"));
    projectA = await mkdtemp(join(tmpdir(), "lucky-picker-a-"));
    projectB = await mkdtemp(join(tmpdir(), "lucky-picker-b-"));
    process.env.HOME = home;
    const now = Date.now();
    saveSession(session("fix the parser", projectA, now - 60_000));
    saveSession(session("write the docs", projectB, now - 120_000));
  });

  afterEach(async () => {
    process.env.HOME = ORIGINAL_HOME;
    for (const dir of [home, projectA, projectB]) await rm(dir, { recursive: true, force: true });
  });

  it("opens on the current project's sessions", () => {
    const { screen } = renderToScreen(<SessionPicker cwd={projectA} onSelect={() => {}} onCancel={() => {}} />, 120);
    expect(scanPositions(screen, "fix the parser")).toHaveLength(1);
    expect(scanPositions(screen, "write the docs")).toHaveLength(0);
    expect(scanPositions(screen, "all projects (+1)")).toHaveLength(1);
  });

  it("falls back to every project when this one has no sessions", async () => {
    const empty = await mkdtemp(join(tmpdir(), "lucky-picker-empty-"));
    try {
      const { screen } = renderToScreen(<SessionPicker cwd={empty} onSelect={() => {}} onCancel={() => {}} />, 140);
      expect(scanPositions(screen, "fix the parser")).toHaveLength(1);
      expect(scanPositions(screen, "write the docs")).toHaveLength(1);
      expect(scanPositions(screen, "all projects · 2 saved")).toHaveLength(1);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});

describe("formatRelativeTime", () => {
  it("reads like a person would say it", () => {
    const now = Date.UTC(2026, 9, 2, 12, 0);
    expect(formatRelativeTime(now - 10_000, now)).toBe("just now");
    expect(formatRelativeTime(now - 12 * 60_000, now)).toBe("12m ago");
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(formatRelativeTime(now - 30 * 3_600_000, now)).toBe("yesterday");
    expect(formatRelativeTime(now - 4 * 86_400_000, now)).toBe("4d ago");
    expect(formatRelativeTime(Date.UTC(2026, 0, 15), now)).toBe("2026-01-15");
  });
});

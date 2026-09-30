import { describe, expect, it } from "vitest";
import { ATTENTION_AFTER_MS, needsAttention, terminalTitle } from "./useTerminalStatus.js";

describe("terminalTitle", () => {
  it("names the folder when idle or working and flags waiting states", () => {
    expect(terminalTitle("idle", "/home/me/project")).toBe("lucky · project");
    expect(terminalTitle("working", "/home/me/project")).toBe("✳ lucky · project");
    expect(terminalTitle("approval", "/home/me/project")).toBe("⚠ lucky · approval needed");
    expect(terminalTitle("question", "/home/me/project")).toBe("? lucky · waiting for you");
  });
});

describe("needsAttention", () => {
  it("rings only after a long unattended stretch of work", () => {
    expect(needsAttention("working", "idle", ATTENTION_AFTER_MS)).toBe(true);
    expect(needsAttention("working", "approval", ATTENTION_AFTER_MS + 1)).toBe(true);
    expect(needsAttention("working", "idle", ATTENTION_AFTER_MS - 1)).toBe(false);
    expect(needsAttention("idle", "working", ATTENTION_AFTER_MS * 2)).toBe(false);
    expect(needsAttention("approval", "idle", ATTENTION_AFTER_MS * 2)).toBe(false);
  });
});

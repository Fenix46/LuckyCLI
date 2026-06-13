import { describe, it, expect } from "vitest";
import { targetPhase, nextPhase, MIN_PHASE_MS } from "./useStableActivity.js";

describe("targetPhase", () => {
  it("is idle when not busy", () => {
    expect(targetPhase(false, false)).toBe("idle");
    expect(targetPhase(false, true)).toBe("idle");
  });

  it("is streaming when busy with text, thinking when busy without", () => {
    expect(targetPhase(true, true)).toBe("streaming");
    expect(targetPhase(true, false)).toBe("thinking");
  });
});

describe("nextPhase", () => {
  it("stays put when already at target", () => {
    expect(nextPhase("thinking", "thinking", 0)).toEqual({
      phase: "thinking",
      retryInMs: null,
    });
  });

  it("switches to/from idle immediately (real turn boundaries)", () => {
    expect(nextPhase("idle", "thinking", 0)).toEqual({ phase: "thinking", retryInMs: null });
    expect(nextPhase("streaming", "idle", 10)).toEqual({ phase: "idle", retryInMs: null });
  });

  it("holds a streaming↔thinking flip until the minimum window elapses", () => {
    // Gap just opened: hold streaming, ask to be re-checked after the remainder.
    const held = nextPhase("streaming", "thinking", 100);
    expect(held.phase).toBe("streaming");
    expect(held.retryInMs).toBe(MIN_PHASE_MS - 100);
  });

  it("allows the flip once the phase has been held long enough", () => {
    expect(nextPhase("streaming", "thinking", MIN_PHASE_MS)).toEqual({
      phase: "thinking",
      retryInMs: null,
    });
    expect(nextPhase("thinking", "streaming", MIN_PHASE_MS + 50)).toEqual({
      phase: "streaming",
      retryInMs: null,
    });
  });
});

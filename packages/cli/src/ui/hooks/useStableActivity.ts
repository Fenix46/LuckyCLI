import { useEffect, useRef, useState } from "react";

/**
 * Smooths the thinking↔streaming transition so the activity indicator never
 * flickers or appears to vanish during a turn.
 *
 * Ported from Claude Code's Spinner thinking-status state machine: an activity
 * phase is held visible for a minimum duration before it's allowed to flip, so
 * the brief gaps that punctuate a turn — a tool call committing the narration
 * block, a silent pause between text deltas — don't make the "lucky thinking"
 * header blink in and out. Without the hold, `busy && !streaming` flips to the
 * thinking phase for a single frame and the header looks like the model stalled.
 *
 * Provider-agnostic: it only reasons about whether text is currently streaming
 * and whether a turn is active, never about a specific provider's event shape.
 */
export type ActivityPhase = "streaming" | "thinking" | "idle";

export const MIN_PHASE_MS = 500;

/** The phase a turn wants to be in, ignoring the anti-flicker hold. */
export function targetPhase(busy: boolean, hasStreamingText: boolean): ActivityPhase {
  if (!busy) return "idle";
  return hasStreamingText ? "streaming" : "thinking";
}

/**
 * Pure transition: given the current held phase, the desired target, and how
 * long the current phase has been held, decide the next phase and whether a
 * timer is still needed to re-evaluate.
 *
 * - idle is a real boundary (turn start/end) → switch immediately.
 * - streaming↔thinking flips are held for MIN_PHASE_MS to absorb micro-gaps.
 */
export function nextPhase(
  current: ActivityPhase,
  target: ActivityPhase,
  heldMs: number,
): { phase: ActivityPhase; retryInMs: number | null } {
  if (target === current) return { phase: current, retryInMs: null };
  if (target === "idle" || current === "idle") {
    return { phase: target, retryInMs: null };
  }
  const wait = MIN_PHASE_MS - heldMs;
  if (wait <= 0) return { phase: target, retryInMs: null };
  return { phase: current, retryInMs: wait };
}

export function useStableActivity(
  busy: boolean,
  hasStreamingText: boolean,
  now: () => number = Date.now,
): { phase: ActivityPhase } {
  const target = targetPhase(busy, hasStreamingText);
  const [phase, setPhase] = useState<ActivityPhase>(target);
  const lastChangeRef = useRef<number>(now());

  useEffect(() => {
    const { phase: resolved, retryInMs } = nextPhase(
      phase,
      target,
      now() - lastChangeRef.current,
    );
    if (resolved !== phase) {
      setPhase(resolved);
      lastChangeRef.current = now();
      return;
    }
    if (retryInMs !== null) {
      const id = setTimeout(() => {
        setPhase(target);
        lastChangeRef.current = now();
      }, retryInMs);
      return () => clearTimeout(id);
    }
    return;
  }, [target, phase, now]);

  return { phase };
}

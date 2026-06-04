import { useEffect, useState } from "react";

export interface ElapsedTimer {
  /** Whole seconds since the turn started; 0 when idle. */
  elapsedSeconds: number;
  /** Monotonic tick used to advance the thinking animation. */
  activityFrame: number;
}

/**
 * A single 500ms interval that drives both the elapsed-time readout and the
 * thinking animation while a turn is in progress. The interval only runs while
 * `busy` is true, so an idle session does no periodic work.
 */
export function useElapsedTimer(busy: boolean, startedAt: number | null): ElapsedTimer {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [activityFrame, setActivityFrame] = useState(0);

  useEffect(() => {
    if (!busy || startedAt === null) {
      setElapsedSeconds(0);
      return;
    }
    const timer = setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
      setActivityFrame((frame) => frame + 1);
    }, 500);
    return () => clearInterval(timer);
  }, [busy, startedAt]);

  return { elapsedSeconds, activityFrame };
}

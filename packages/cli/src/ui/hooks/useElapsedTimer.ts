import { useEffect, useRef, useState } from "react";

export interface ElapsedTimer {
  /** Whole seconds since the turn started; 0 when idle. */
  elapsedSeconds: number;
  /** Monotonic tick used to advance the thinking animation. */
  activityFrame: number;
}

/**
 * Drives the elapsed-time readout and the thinking animation while a turn is in
 * progress. Previously layered on Ink's `useAnimation`; the vendored Ink fork
 * doesn't expose that hook, so this uses a plain 500ms interval — a coarse
 * timer doesn't need to be tied to the render loop. Resets to 0 when `busy`
 * flips off. `startedAt` anchors elapsed time so it survives re-renders.
 */
export function useElapsedTimer(busy: boolean, startedAt: number | null): ElapsedTimer {
  const [frame, setFrame] = useState(0);
  const [, forceTick] = useState(0);
  const frameRef = useRef(0);

  useEffect(() => {
    if (!busy) {
      frameRef.current = 0;
      setFrame(0);
      return;
    }
    const id = setInterval(() => {
      frameRef.current += 1;
      setFrame(frameRef.current);
      forceTick((n) => n + 1);
    }, 500);
    return () => clearInterval(id);
  }, [busy]);

  const elapsedSeconds =
    busy && startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0;

  return { elapsedSeconds, activityFrame: frame };
}

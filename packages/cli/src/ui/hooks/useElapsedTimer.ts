import { useAnimation } from "ink";

export interface ElapsedTimer {
  /** Whole seconds since the turn started; 0 when idle. */
  elapsedSeconds: number;
  /** Monotonic tick used to advance the thinking animation. */
  activityFrame: number;
}

/**
 * Drives the elapsed-time readout and the thinking animation while a turn is in
 * progress, on top of Ink's useAnimation (single shared timer; resets to 0 when
 * isActive flips off). `startedAt` is unused now that useAnimation tracks
 * elapsed time itself, but kept in the signature for call-site clarity.
 */
export function useElapsedTimer(busy: boolean, _startedAt: number | null): ElapsedTimer {
  const { frame, time } = useAnimation({ interval: 500, isActive: busy });
  return {
    elapsedSeconds: busy ? Math.floor(time / 1000) : 0,
    activityFrame: frame,
  };
}

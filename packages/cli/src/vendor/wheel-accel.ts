/**
 * Wheel-scroll acceleration curve, ported VERBATIM from Claude Code's
 * src/components/ScrollKeybindingHandler.tsx (the `computeWheelStep` function +
 * its constants and WheelAccelState). Extracted standalone because the full
 * handler (1011 LOC) is coupled to notifications/keybindings/selection we don't
 * need — but this curve is the part that makes wheel scrolling feel like a real
 * document instead of one-row-per-tick.
 *
 * It distinguishes mouse wheel from trackpad, handles cheap-encoder bounce
 * (spurious reverse ticks), and applies an exponential decay so fast spins
 * cover ground while slow clicks stay precise. State lives in a caller-owned
 * object (a useRef) and is mutated in place.
 */

// Native terminals: hard-window linear ramp.
const WHEEL_ACCEL_WINDOW_MS = 40;
const WHEEL_ACCEL_STEP = 0.3;
const WHEEL_ACCEL_MAX = 6;

// Encoder bounce debounce + wheel-mode decay curve.
const WHEEL_BOUNCE_GAP_MAX_MS = 200; // flip-back must arrive within this
const WHEEL_MODE_STEP = 15;
const WHEEL_MODE_CAP = 15;
const WHEEL_MODE_RAMP = 3;
const WHEEL_MODE_IDLE_DISENGAGE_MS = 1500;

// xterm.js (VS Code): exponential decay.
const WHEEL_DECAY_HALFLIFE_MS = 150;
const WHEEL_DECAY_STEP = 5;
const WHEEL_BURST_MS = 5;
const WHEEL_DECAY_GAP_MS = 80;
const WHEEL_DECAY_CAP_SLOW = 3; // gap ≥ GAP_MS: precision
const WHEEL_DECAY_CAP_FAST = 6; // gap < GAP_MS: throughput
const WHEEL_DECAY_IDLE_MS = 500;

export type WheelAccelState = {
  time: number;
  mult: number;
  dir: 0 | 1 | -1;
  xtermJs: boolean;
  /** Carried fractional scroll (xterm.js only). */
  frac: number;
  /** Native-path baseline rows/event. */
  base: number;
  /** Deferred direction flip (native only) — bounce vs. real reversal. */
  pendingFlip: boolean;
  /** True once a bounce confirms a physical wheel; sticky until device switch. */
  wheelMode: boolean;
  /** Consecutive <5ms events — trackpad-flick signature. */
  burstCount: number;
};

/** Create the per-component accel state. `xtermJs` selects the VS Code curve;
 *  `base` is the baseline rows/event (1 for terminals that pre-amplify, higher
 *  to match vim-style speed on terminals that send 1 event/notch). */
export function createWheelAccelState(xtermJs: boolean, base = 1): WheelAccelState {
  return {
    time: 0,
    mult: base,
    dir: 0,
    xtermJs,
    frac: 0,
    base,
    pendingFlip: false,
    wheelMode: false,
    burstCount: 0,
  };
}

/** Compute rows for one wheel event, mutating accel state. Returns 0 when a
 *  direction flip is deferred for bounce detection (caller no-ops on 0). */
export function computeWheelStep(state: WheelAccelState, dir: 1 | -1, now: number): number {
  if (!state.xtermJs) {
    if (state.wheelMode && now - state.time > WHEEL_MODE_IDLE_DISENGAGE_MS) {
      state.wheelMode = false;
      state.burstCount = 0;
      state.mult = state.base;
    }

    if (state.pendingFlip) {
      state.pendingFlip = false;
      if (dir !== state.dir || now - state.time > WHEEL_BOUNCE_GAP_MAX_MS) {
        state.dir = dir;
        state.time = now;
        state.mult = state.base;
        return Math.floor(state.mult);
      }
      state.wheelMode = true;
    }
    const gap = now - state.time;
    if (dir !== state.dir && state.dir !== 0) {
      state.pendingFlip = true;
      state.time = now;
      return 0;
    }
    state.dir = dir;
    state.time = now;

    // ─── MOUSE (wheel mode, sticky until device-switch signal) ───
    if (state.wheelMode) {
      if (gap < WHEEL_BURST_MS) {
        if (++state.burstCount >= 5) {
          state.wheelMode = false;
          state.burstCount = 0;
          state.mult = state.base;
        } else {
          return 1;
        }
      } else {
        state.burstCount = 0;
      }
    }
    if (state.wheelMode) {
      const m = Math.pow(0.5, gap / WHEEL_DECAY_HALFLIFE_MS);
      const cap = Math.max(WHEEL_MODE_CAP, state.base * 2);
      const next = 1 + (state.mult - 1) * m + WHEEL_MODE_STEP * m;
      state.mult = Math.min(cap, next, state.mult + WHEEL_MODE_RAMP);
      return Math.floor(state.mult);
    }

    // ─── TRACKPAD / HI-RES (native, non-wheel-mode) ───
    if (gap > WHEEL_ACCEL_WINDOW_MS) {
      state.mult = state.base;
    } else {
      const cap = Math.max(WHEEL_ACCEL_MAX, state.base * 2);
      state.mult = Math.min(cap, state.mult + WHEEL_ACCEL_STEP);
    }
    return Math.floor(state.mult);
  }

  // ─── VSCODE (xterm.js, browser wheel events) ───
  const gap = now - state.time;
  const sameDir = dir === state.dir;
  state.time = now;
  state.dir = dir;
  if (sameDir && gap < WHEEL_BURST_MS) return 1;
  if (!sameDir || gap > WHEEL_DECAY_IDLE_MS) {
    state.mult = 2;
    state.frac = 0;
  } else {
    const m = Math.pow(0.5, gap / WHEEL_DECAY_HALFLIFE_MS);
    const cap = gap >= WHEEL_DECAY_GAP_MS ? WHEEL_DECAY_CAP_SLOW : WHEEL_DECAY_CAP_FAST;
    state.mult = Math.min(cap, 1 + (state.mult - 1) * m + WHEEL_DECAY_STEP * m);
  }
  const total = state.mult + state.frac;
  const rows = Math.floor(total);
  state.frac = total - rows;
  return rows;
}

import { basename } from "node:path";
import { useContext, useEffect, useRef } from "react";
import { useTerminalTitle } from "../../vendor/ink/hooks/use-terminal-title.js";
import { TerminalWriteContext } from "../../vendor/ink/useTerminalNotification.js";
import { isProgressReportingAvailable } from "../../vendor/ink/terminal.js";
import { BEL } from "../../vendor/ink/termio/ansi.js";
import { ITERM2, OSC, PROGRESS, osc, wrapForMultiplexer } from "../../vendor/ink/termio/osc.js";

export type TerminalActivity = "idle" | "working" | "approval" | "question";

// A turn this long is one the user has probably stopped watching: ring the
// bell when it ends or stops to ask something.
export const ATTENTION_AFTER_MS = 30_000;

/** Tab/window title for the current activity. */
export function terminalTitle(activity: TerminalActivity, cwd: string): string {
  const folder = basename(cwd) || cwd;
  switch (activity) {
    case "working":
      return `✳ lucky · ${folder}`;
    case "approval":
      return `⚠ lucky · approval needed`;
    case "question":
      return `? lucky · waiting for you`;
    default:
      return `lucky · ${folder}`;
  }
}

/**
 * Whether a change of activity deserves the terminal bell: the agent has been
 * working unattended for a while and now either finished or needs an answer.
 */
export function needsAttention(
  previous: TerminalActivity,
  next: TerminalActivity,
  workingForMs: number,
): boolean {
  if (previous !== "working" || next === "working") return false;
  return workingForMs >= ATTENTION_AFTER_MS;
}

/**
 * Mirror the session state outside the TUI: the terminal title says whether
 * lucky is working or waiting on the user, terminals that support OSC 9;4 show
 * an indeterminate progress indicator while a turn runs, and a long unattended
 * turn rings the bell when it finishes or stops for approval.
 * LUCKY_NOTIFY=off disables the bell.
 */
export function useTerminalStatus(activity: TerminalActivity): void {
  // Null outside Ink (e.g. tests): the hook then does nothing.
  const writeRaw: ((data: string) => void) | null = useContext(TerminalWriteContext);
  useTerminalTitle(writeRaw !== null ? terminalTitle(activity, process.cwd()) : null);

  const previousRef = useRef<TerminalActivity>(activity);
  const workingSinceRef = useRef<number | null>(activity === "working" ? Date.now() : null);

  useEffect(() => {
    const previous = previousRef.current;
    if (previous === activity) return;
    previousRef.current = activity;
    if (!writeRaw) return;
    const progress = (state: number) => {
      if (isProgressReportingAvailable()) {
        writeRaw(wrapForMultiplexer(osc(OSC.ITERM2, ITERM2.PROGRESS, state, "")));
      }
    };

    if (activity === "working") {
      workingSinceRef.current ??= Date.now();
      progress(PROGRESS.INDETERMINATE);
      return;
    }
    const since = workingSinceRef.current;
    const workingForMs = since === null ? 0 : Date.now() - since;
    if (activity === "idle") workingSinceRef.current = null;
    progress(PROGRESS.CLEAR);
    if (needsAttention(previous, activity, workingForMs) && process.env.LUCKY_NOTIFY !== "off") {
      // Raw BEL: inside tmux it also sets the window's bell flag.
      writeRaw(BEL);
    }
  }, [activity, writeRaw]);
}

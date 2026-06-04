import { useStdin, useStdout } from "ink";
import { useEffect } from "react";

// SGR mouse tracking: 1000 = button/wheel press-release, 1006 = SGR encoding
// (CSI < btn ; col ; row M/m). We only need wheel events, so we skip 1002/1003
// (drag/motion). Enabling this means the terminal sends wheel/click to the app
// instead of doing native selection — but it's the only way to get the wheel.
const ENABLE = "\x1b[?1000h\x1b[?1006h";
const DISABLE = "\x1b[?1006l\x1b[?1000l";

// SGR wheel events: ESC [ < 64 ; col ; row M  (wheel up)
//                   ESC [ < 65 ; col ; row M  (wheel down)
// Button 64 = wheel-up, 65 = wheel-down (0x40 | wheel-bit).
const WHEEL_RE = /\x1b\[<(6[45]);\d+;\d+M/g;

/**
 * Enable SGR mouse-wheel tracking and report wheel ticks. While active, the
 * terminal sends wheel events to the app (so native mouse text selection needs
 * Shift on most terminals). Listens to stdin directly, alongside Ink's own
 * input handling, and matches only the wheel sequences — click/drag bytes are
 * ignored.
 */
export function useMouseWheel(onWheel: (direction: "up" | "down", ticks: number) => void): void {
  const { stdout } = useStdout();
  const { stdin, isRawModeSupported, setRawMode } = useStdin();

  useEffect(() => {
    if (!stdout || !stdin || !isRawModeSupported) return;
    // Raw mode is required for stdin to deliver the escape sequences byte-wise.
    setRawMode(true);
    stdout.write(ENABLE);

    const onData = (data: Buffer | string) => {
      const text = typeof data === "string" ? data : data.toString("utf8");
      let up = 0;
      let down = 0;
      for (const match of text.matchAll(WHEEL_RE)) {
        if (match[1] === "64") up++;
        else down++;
      }
      if (up > 0) onWheel("up", up);
      if (down > 0) onWheel("down", down);
    };

    stdin.on("data", onData);
    return () => {
      stdin.off("data", onData);
      stdout.write(DISABLE);
    };
  }, [stdout, stdin, isRawModeSupported, setRawMode, onWheel]);
}

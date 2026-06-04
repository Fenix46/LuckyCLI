import { useStdout } from "ink";
import { useEffect, useState } from "react";

export interface TerminalSize {
  width: number;
  height: number;
}

/**
 * Track the terminal dimensions, updating on resize. Uses Ink's useStdout()
 * for the output stream rather than reaching for the global process.stdout, so
 * the component stays aligned with the renderer Ink is actually writing to.
 */
export function useTerminalSize(): TerminalSize {
  const { stdout } = useStdout();
  const [size, setSize] = useState<TerminalSize>(() => ({
    width: stdout?.columns ?? 100,
    height: stdout?.rows ?? 30,
  }));

  useEffect(() => {
    if (!stdout) return;
    function handleResize() {
      setSize({
        width: stdout.columns ?? 100,
        height: stdout.rows ?? 30,
      });
    }
    stdout.on("resize", handleResize);
    return () => {
      stdout.off("resize", handleResize);
    };
  }, [stdout]);

  return size;
}

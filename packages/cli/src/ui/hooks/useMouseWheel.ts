import { useEffect } from "react";
import { wheelEmitter, type WheelDirection } from "../../mouse-input.js";

/**
 * Subscribe to mouse-wheel ticks. The actual SGR mouse sequences are filtered
 * out of stdin at the entrypoint (createMouseFilteredStdin) so they never reach
 * Ink's input parser; this hook just listens to the resulting wheel events.
 */
export function useMouseWheel(onWheel: (direction: WheelDirection, ticks: number) => void): void {
  useEffect(() => {
    wheelEmitter.on("wheel", onWheel);
    return () => {
      wheelEmitter.off("wheel", onWheel);
    };
  }, [onWheel]);
}

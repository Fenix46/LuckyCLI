import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

/**
 * SGR mouse sequences: CSI < btn ; col ; row M|m. Button 64 = wheel-up,
 * 65 = wheel-down (0x40 | wheel bit); other buttons are clicks/drags.
 */
const SGR_MOUSE_RE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;

export type WheelDirection = "up" | "down";

/**
 * Process-wide wheel event bus. createMouseFilteredStdin emits "wheel" with the
 * direction and tick count; the UI subscribes via useMouseWheel. Decoupling
 * through an emitter lets the filtering live at the stdin boundary (index.tsx)
 * while the scroll state lives in the React tree.
 */
export const wheelEmitter = new EventEmitter();

export interface MouseFilteredStdin {
  /** A TTY-like stream to hand to Ink's render({ stdin }). */
  stdin: NodeJS.ReadStream;
  /** Stop forwarding and detach from the real stdin. */
  dispose: () => void;
}

/**
 * Wrap process.stdin so that SGR mouse sequences never reach Ink (they would
 * otherwise leak into the prompt as raw "<64;..M" text, since Ink's parser
 * doesn't understand them). Wheel ticks are published on `wheelEmitter`;
 * everything else is forwarded to Ink unchanged.
 *
 * The returned stream proxies isTTY / setRawMode / ref / unref to the real
 * stdin so Ink still detects an interactive terminal and can enable raw mode.
 */
export function createMouseFilteredStdin(source: NodeJS.ReadStream): MouseFilteredStdin {
  const proxy = new PassThrough() as unknown as NodeJS.ReadStream & PassThrough;

  // Proxy the bits Ink inspects/calls on a real stdin. PassThrough has no
  // isTTY/setRawMode/ref/unref, so delegate them to the source stream.
  Object.defineProperty(proxy, "isTTY", { get: () => source.isTTY });
  proxy.setRawMode = (mode: boolean) => {
    source.setRawMode?.(mode);
    return proxy;
  };
  proxy.ref = () => {
    source.ref?.();
    return proxy;
  };
  proxy.unref = () => {
    source.unref?.();
    return proxy;
  };

  const onData = (chunk: Buffer | string) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    let up = 0;
    let down = 0;
    const forwarded = text.replace(SGR_MOUSE_RE, (_full, btnStr: string) => {
      const button = Number(btnStr);
      if ((button & 0x40) !== 0) {
        if ((button & 0x01) === 0) up++;
        else down++;
      }
      // Clicks/drags (no wheel bit) are dropped too — we don't use them.
      return "";
    });
    if (up > 0) wheelEmitter.emit("wheel", "up" as WheelDirection, up);
    if (down > 0) wheelEmitter.emit("wheel", "down" as WheelDirection, down);
    if (forwarded.length > 0) proxy.write(forwarded);
  };

  source.on("data", onData);

  return {
    stdin: proxy,
    dispose: () => {
      source.off("data", onData);
      proxy.end();
    },
  };
}

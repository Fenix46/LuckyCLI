import { describe, expect, it } from "vitest";
import { encodeFrame, FrameDecoder, MAX_NATIVE_FRAME_BYTES } from "./frames.js";

describe("encodeFrame / FrameDecoder", () => {
  it("round-trips one message", () => {
    const decoder = new FrameDecoder();
    expect(decoder.push(encodeFrame({ type: "ping" }))).toEqual([{ type: "ping" }]);
  });

  it("handles several frames in one chunk and a frame split across chunks", () => {
    const a = encodeFrame({ type: "a" });
    const b = encodeFrame({ type: "b" });
    const decoder = new FrameDecoder();
    expect(decoder.push(Buffer.concat([a, b]))).toEqual([{ type: "a" }, { type: "b" }]);

    const split = encodeFrame({ type: "split", value: "x".repeat(20) });
    expect(decoder.push(split.subarray(0, 5))).toEqual([]);
    expect(decoder.push(split.subarray(5))).toEqual([{ type: "split", value: "x".repeat(20) }]);
  });

  it("rejects an invalid or oversized length", () => {
    const zero = Buffer.alloc(4);
    expect(() => new FrameDecoder().push(zero)).toThrow(/Invalid native frame length/);

    const huge = Buffer.alloc(4);
    huge.writeUInt32LE(MAX_NATIVE_FRAME_BYTES + 1, 0);
    expect(() => new FrameDecoder().push(huge)).toThrow(/Invalid native frame length/);
  });

  it("refuses to encode an oversized message", () => {
    expect(() => encodeFrame({ value: "x".repeat(MAX_NATIVE_FRAME_BYTES) })).toThrow(/over the/);
  });
});

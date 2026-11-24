/**
 * Chrome native messaging framing: a 32-bit little-endian length followed by
 * UTF-8 JSON. The same framing is used on the Unix socket side of the bridge,
 * so one codec serves both hops.
 */

export const MAX_NATIVE_FRAME_BYTES = 1024 * 1024;

/** Encode one message as a length-prefixed frame. */
export function encodeFrame(value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  if (payload.length > MAX_NATIVE_FRAME_BYTES) {
    throw new Error(`Native message is ${payload.length} bytes, over the ${MAX_NATIVE_FRAME_BYTES} byte limit.`);
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

/** Incremental decoder for a stream of frames. */
export class FrameDecoder {
  private buffer = Buffer.alloc(0);

  /** Append a chunk and return every complete message it completed. */
  push(chunk: Buffer): unknown[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: unknown[] = [];
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (length === 0 || length > MAX_NATIVE_FRAME_BYTES) {
        throw new Error(`Invalid native frame length: ${length}.`);
      }
      if (this.buffer.length < 4 + length) break;
      const payload = this.buffer.subarray(4, 4 + length).toString("utf8");
      this.buffer = this.buffer.subarray(4 + length);
      messages.push(JSON.parse(payload) as unknown);
    }
    return messages;
  }

  /** Bytes buffered for an incomplete frame. */
  pending(): number {
    return this.buffer.length;
  }
}

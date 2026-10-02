/**
 * What the model has already read in this conversation, so read_file can
 * answer a repeat read of unchanged content with a short pointer instead of
 * re-sending the whole file (which would then ride along on every later
 * request). Owned by the agent: it forgets reads whose result was cleared or
 * compacted out of the transcript, so a pointer never leads to text the model
 * can no longer see.
 */
export class ReadLedger {
  /** read key (path + range) -> content hash and the call that returned it. */
  private readonly reads = new Map<string, { hash: string; toolCallId: string }>();

  /** True when this exact read returned this exact content earlier and is still visible. */
  has(key: string, hash: string): boolean {
    return this.reads.get(key)?.hash === hash;
  }

  record(key: string, hash: string, toolCallId: string): void {
    this.reads.set(key, { hash, toolCallId });
  }

  /** Forget reads whose results are no longer in the transcript. */
  forgetCalls(toolCallIds: Iterable<string>): void {
    const gone = new Set(toolCallIds);
    for (const [key, entry] of this.reads) {
      if (gone.has(entry.toolCallId)) this.reads.delete(key);
    }
  }

  clear(): void {
    this.reads.clear();
  }
}

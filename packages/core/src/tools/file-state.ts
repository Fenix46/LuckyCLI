import { createHash } from "node:crypto";

/**
 * What the model has read in this conversation, per absolute path, so the
 * mutation tools can require a fresh read before changing a file.
 *
 * Claude Code's Edit/Write tools refuse to touch an existing file the model
 * has not read, and refuse again when the file changed on disk since that
 * read. The prompt tells the model to read first; this ledger makes the rule
 * enforceable instead of advisory.
 *
 * Owned by the agent, like ReadLedger. Entries are dropped when the read's
 * tool result is pruned or compacted out of the transcript, so a stale
 * "already read" fact never survives the text it referred to.
 */
export class FileStateLedger {
  /** absolute path -> hash of the content last read or written. */
  private readonly states = new Map<string, { hash: string; toolCallId?: string }>();

  /** Record a successful read of `content` (the full text of the file). */
  recordRead(absPath: string, content: string, toolCallId?: string): void {
    this.states.set(absPath, {
      hash: contentHash(content),
      ...(toolCallId ? { toolCallId } : {}),
    });
  }

  /** Record a successful write/edit: the new content is now the known state. */
  recordWrite(absPath: string, content: string): void {
    this.states.set(absPath, { hash: contentHash(content) });
  }

  /** A deleted file has no readable state any more. */
  forgetPath(absPath: string): void {
    this.states.delete(absPath);
  }

  /** Forget reads whose tool results are no longer in the transcript. */
  forgetCalls(toolCallIds: Iterable<string>): void {
    const gone = new Set(toolCallIds);
    if (gone.size === 0) return;
    for (const [path, state] of this.states) {
      if (state.toolCallId !== undefined && gone.has(state.toolCallId)) {
        this.states.delete(path);
      }
    }
  }

  /**
   * Check whether `currentContent` may be edited without re-reading it.
   * "unread" means the model never read this path in the visible transcript;
   * "stale" means it did, but the file changed since.
   */
  check(absPath: string, currentContent: string): FileStateCheck {
    const state = this.states.get(absPath);
    if (!state) return { ok: false, reason: "unread" };
    if (state.hash !== contentHash(currentContent)) return { ok: false, reason: "stale" };
    return { ok: true };
  }

  clear(): void {
    this.states.clear();
  }
}

export type FileStateCheck =
  | { ok: true }
  | { ok: false; reason: "unread" | "stale" };

export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** The message a mutation tool returns when the read-before-edit gate refuses. */
export function describeFileStateFailure(
  path: string,
  reason: "unread" | "stale",
): string {
  return reason === "unread"
    ? `Read ${path} with read_file before changing it, then retry the edit.`
    : `${path} changed on disk since your last read. Read it again, then retry the edit.`;
}

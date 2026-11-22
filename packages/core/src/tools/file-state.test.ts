import { describe, expect, it } from "vitest";
import { FileStateLedger, contentHash } from "./file-state.js";

describe("FileStateLedger", () => {
  it("reports a path that was never read", () => {
    const ledger = new FileStateLedger();
    expect(ledger.check("/repo/a.ts", "a")).toEqual({ ok: false, reason: "unread" });
  });

  it("accepts the exact content that was read", () => {
    const ledger = new FileStateLedger();
    ledger.recordRead("/repo/a.ts", "one\ntwo\n", "call-1");
    expect(ledger.check("/repo/a.ts", "one\ntwo\n")).toEqual({ ok: true });
  });

  it("reports content that changed after the read", () => {
    const ledger = new FileStateLedger();
    ledger.recordRead("/repo/a.ts", "old", "call-1");
    expect(ledger.check("/repo/a.ts", "new")).toEqual({ ok: false, reason: "stale" });
  });

  it("treats a successful write as the new known state", () => {
    const ledger = new FileStateLedger();
    ledger.recordRead("/repo/a.ts", "old", "call-1");
    ledger.recordWrite("/repo/a.ts", "new");
    expect(ledger.check("/repo/a.ts", "new")).toEqual({ ok: true });
    expect(ledger.check("/repo/a.ts", "old")).toEqual({ ok: false, reason: "stale" });
  });

  it("forgets reads whose tool result left the transcript", () => {
    const ledger = new FileStateLedger();
    ledger.recordRead("/repo/a.ts", "a", "call-1");
    ledger.recordRead("/repo/b.ts", "b", "call-2");
    ledger.forgetCalls(["call-1"]);
    expect(ledger.check("/repo/a.ts", "a")).toEqual({ ok: false, reason: "unread" });
    expect(ledger.check("/repo/b.ts", "b")).toEqual({ ok: true });
  });

  it("forgets a deleted path and clears everything on compaction", () => {
    const ledger = new FileStateLedger();
    ledger.recordWrite("/repo/a.ts", "a");
    ledger.forgetPath("/repo/a.ts");
    expect(ledger.check("/repo/a.ts", "a")).toEqual({ ok: false, reason: "unread" });
    ledger.recordWrite("/repo/b.ts", "b");
    ledger.clear();
    expect(ledger.check("/repo/b.ts", "b")).toEqual({ ok: false, reason: "unread" });
  });

  it("hashes content deterministically", () => {
    expect(contentHash("same")).toBe(contentHash("same"));
    expect(contentHash("same")).not.toBe(contentHash("different"));
  });
});

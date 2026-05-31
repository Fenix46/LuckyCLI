import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Message } from "../providers/types.js";
import {
  createSessionId,
  deleteSession,
  deriveTitle,
  isValidSessionId,
  latestSession,
  listSessions,
  loadSession,
  saveSession,
  sessionsDirPath,
  type Session,
} from "./store.js";

const ORIGINAL_HOME = process.env.HOME;

function makeSession(overrides: Partial<Session> = {}): Session {
  const now = Date.now();
  return {
    id: createSessionId(),
    provider: "claude",
    model: "claude-sonnet-4-6",
    createdAt: now,
    updatedAt: now,
    messages: [{ role: "user", content: [{ type: "text", text: "hello there" }] }],
    ...overrides,
  };
}

describe("session store", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "lucky-home-"));
    process.env.HOME = home;
  });

  afterEach(async () => {
    process.env.HOME = ORIGINAL_HOME;
    await rm(home, { recursive: true, force: true });
  });

  it("saves and loads a session round-trip", () => {
    const session = makeSession();
    saveSession(session);
    expect(loadSession(session.id)).toEqual(session);
  });

  it("returns undefined for a missing session", () => {
    expect(loadSession("ses_nope")).toBeUndefined();
  });

  it("lists sessions as metadata, newest first", () => {
    const older = makeSession({ updatedAt: 1000, messages: [] });
    const newer = makeSession({ updatedAt: 2000 });
    saveSession(older);
    saveSession(newer);

    const list = listSessions();
    expect(list.map((s) => s.id)).toEqual([newer.id, older.id]);
    expect(list[0]).not.toHaveProperty("messages");
    expect(list[0]!.messageCount).toBe(1);
    expect(latestSession()?.id).toBe(newer.id);
  });

  it("deletes a session", () => {
    const session = makeSession();
    saveSession(session);
    expect(deleteSession(session.id)).toBe(true);
    expect(loadSession(session.id)).toBeUndefined();
    expect(deleteSession(session.id)).toBe(false);
  });

  it("derives a title from the first user message", () => {
    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: "  fix the   login bug " }] },
    ];
    expect(deriveTitle(messages)).toBe("fix the login bug");
  });

  it("truncates long titles", () => {
    const long = "x".repeat(100);
    const title = deriveTitle([{ role: "user", content: [{ type: "text", text: long }] }]);
    expect(title).toHaveLength(60);
    expect(title?.endsWith("...")).toBe(true);
  });

  it("ignores empty session directories", () => {
    expect(listSessions()).toEqual([]);
    expect(latestSession()).toBeUndefined();
  });

  it("rejects invalid session ids", () => {
    expect(isValidSessionId("ses_abc_123")).toBe(true);
    expect(isValidSessionId("../secret")).toBe(false);
    expect(loadSession("../secret")).toBeUndefined();
    expect(deleteSession("../secret")).toBe(false);
    expect(() => saveSession(makeSession({ id: "../secret" }))).toThrow(/invalid session id/i);
  });

  it("skips session files whose payload id does not match the file name", async () => {
    await mkdir(sessionsDirPath(), { recursive: true });
    await writeFile(
      `${sessionsDirPath()}/ses_abc_123.json`,
      JSON.stringify(makeSession({ id: "ses_def_456" })),
      "utf8",
    );

    expect(listSessions()).toEqual([]);
  });
});

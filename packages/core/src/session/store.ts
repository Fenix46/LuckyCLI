/**
 * Persistent on-disk chat sessions at ~/.luckycli/sessions/<id>.json.
 *
 * One JSON file per session keeps things simple and inspectable — no database.
 * A session holds the canonical message history plus enough metadata to list
 * and resume it. Files are written 0600 since transcripts can contain code and
 * other sensitive context.
 *
 * Inspired by opencode's session model, pared down to luckycli's flat-file style.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Message, ProviderId } from "../providers/types.js";
import { CheckpointSchema, type Checkpoint } from "../workflow/types.js";

const SESSION_ID_RE = /^ses_[a-z0-9]+_[a-z0-9]+$/;

/** Listing-friendly summary of a session, without the message payload. */
export interface SessionMeta {
  id: string;
  title?: string;
  provider: ProviderId;
  model: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

/** A full persisted session. */
export interface Session {
  id: string;
  title?: string;
  provider: ProviderId;
  model: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  /** Optional for backwards compatibility with sessions saved before checkpoints. */
  checkpoints?: Checkpoint[];
}

export function sessionsDirPath(): string {
  return join(homedir(), ".luckycli", "sessions");
}

export function sessionFilePath(id: string): string {
  assertValidSessionId(id);
  return join(sessionsDirPath(), `${id}.json`);
}

export function isValidSessionId(id: string): boolean {
  return SESSION_ID_RE.test(id);
}

function assertValidSessionId(id: string): void {
  if (!isValidSessionId(id)) {
    throw new Error("Invalid session id.");
  }
}

/** A short, time-sortable, collision-resistant session id. */
export function createSessionId(): string {
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `ses_${time}_${rand}`;
}

/** First line of the first user message, trimmed for use as a session title. */
export function deriveTitle(messages: Message[]): string | undefined {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return undefined;
  const text = firstUser.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return undefined;
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

export function saveSession(session: Session): void {
  assertValidSessionId(session.id);
  mkdirSync(sessionsDirPath(), { recursive: true });
  const file = sessionFilePath(session.id);
  const tmp = join(
    sessionsDirPath(),
    `.${session.id}.${process.pid}.${Date.now()}.tmp`,
  );
  writeFileSync(tmp, `${JSON.stringify(session, null, 2)}\n`, "utf8");
  try {
    chmodSync(tmp, 0o600);
  } catch {
    // best-effort on platforms without POSIX permissions
  }
  renameSync(tmp, file);
}

export function loadSession(id: string): Session | undefined {
  try {
    if (!isValidSessionId(id)) return undefined;
    const file = sessionFilePath(id);
    if (!existsSync(file)) return undefined;
    return JSON.parse(readFileSync(file, "utf8")) as Session;
  } catch {
    return undefined;
  }
}

/** Every saved session as metadata, most recently updated first. */
export function listSessions(): SessionMeta[] {
  const dir = sessionsDirPath();
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }

  const metas: SessionMeta[] = [];
  for (const name of files) {
    if (!name.endsWith(".json")) continue;
    const fileId = name.slice(0, -".json".length);
    if (!isValidSessionId(fileId)) continue;
    try {
      const session = JSON.parse(
        readFileSync(join(dir, name), "utf8"),
      ) as Session;
      if (session.id !== fileId || !isValidSessionId(session.id)) continue;
      metas.push({
        id: session.id,
        ...(session.title ? { title: session.title } : {}),
        provider: session.provider,
        model: session.model,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: session.messages?.length ?? 0,
      });
    } catch {
      // skip corrupt files
    }
  }

  return metas.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Metadata for the most recently updated session, if any. */
export function latestSession(): SessionMeta | undefined {
  return listSessions()[0];
}

export function deleteSession(id: string): boolean {
  try {
    if (!isValidSessionId(id)) return false;
    const file = sessionFilePath(id);
    if (!existsSync(file)) return false;
    rmSync(file);
    return true;
  } catch {
    return false;
  }
}

/** Attach or replace a checkpoint in a persisted session. */
export function attachSessionCheckpoint(
  sessionId: string,
  checkpoint: Checkpoint,
): boolean {
  const session = loadSession(sessionId);
  if (!session) return false;
  CheckpointSchema.parse(checkpoint);
  if (checkpoint.sessionId !== sessionId) {
    throw new Error("Checkpoint does not belong to the session.");
  }
  const checkpoints = session.checkpoints ? [...session.checkpoints] : [];
  const index = checkpoints.findIndex((entry) => entry.id === checkpoint.id);
  if (index === -1) checkpoints.push(checkpoint);
  else checkpoints[index] = checkpoint;
  session.checkpoints = checkpoints;
  session.updatedAt = Date.now();
  saveSession(session);
  return true;
}

/** List valid checkpoints for a session, newest first. Corrupt entries are skipped. */
export function listSessionCheckpoints(sessionId: string): Checkpoint[] {
  const session = loadSession(sessionId);
  if (!session?.checkpoints) return [];
  return session.checkpoints
    .flatMap((entry) => {
      const parsed = CheckpointSchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Load one checkpoint and report corruption instead of silently restoring it. */
export function getSessionCheckpoint(
  sessionId: string,
  checkpointId: string,
): Checkpoint | undefined {
  const session = loadSession(sessionId);
  const entry = session?.checkpoints?.find((checkpoint) => checkpoint.id === checkpointId);
  if (!entry) return undefined;
  return CheckpointSchema.parse(entry);
}

/** Remove one checkpoint reference from a persisted session. */
export function removeSessionCheckpoint(
  sessionId: string,
  checkpointId: string,
): boolean {
  const session = loadSession(sessionId);
  if (!session?.checkpoints) return false;
  const checkpoints = session.checkpoints.filter((checkpoint) => checkpoint.id !== checkpointId);
  if (checkpoints.length === session.checkpoints.length) return false;
  session.checkpoints = checkpoints;
  session.updatedAt = Date.now();
  saveSession(session);
  return true;
}

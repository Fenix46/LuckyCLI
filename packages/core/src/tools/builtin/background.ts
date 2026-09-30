import { spawn, type ChildProcess } from "node:child_process";
import { z } from "zod";
import { defineTool } from "../types.js";

/**
 * Long-running shell commands started with `exec` + `background: true` — dev
 * servers, watchers, slow builds. They keep running across tool calls (and
 * turns) while the agent does other work; the `process` tool reads their
 * output and stops them. Every one is stopped when lucky exits.
 */

// Output kept per process; older output is dropped from the front.
const MAX_BUFFER_CHARS = 256 * 1024;
// What one read returns at most (the tail of what's new).
const MAX_READ_CHARS = 16 * 1024;
// How long `exec` waits after starting, so the first result already shows
// whether the command crashed immediately or printed its startup banner.
const STARTUP_WAIT_MS = 2_000;
const MAX_RUNNING = 8;
const STOP_GRACE_MS = 3_000;

export interface BackgroundProcess {
  id: string;
  command: string;
  cwd: string;
  pid: number | undefined;
  startedAt: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  /** Buffered output (stdout and stderr interleaved), possibly trimmed. */
  output: string;
  /** Total characters ever received; `readUpTo` is measured on this scale. */
  received: number;
  readUpTo: number;
  child: ChildProcess;
  exited: Promise<void>;
}

const processes = new Map<string, BackgroundProcess>();
let nextId = 1;
let exitHookInstalled = false;

function isRunning(proc: BackgroundProcess): boolean {
  return proc.exitCode === null && proc.signal === null;
}

function killTree(proc: BackgroundProcess, signal: NodeJS.Signals): void {
  if (proc.pid === undefined) return;
  try {
    // Detached on POSIX, so the negative pid addresses the whole process
    // group: `npm run dev` and the server it spawned both go.
    if (process.platform === "win32") proc.child.kill(signal);
    else process.kill(-proc.pid, signal);
  } catch {
    // already gone
  }
}

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on("exit", () => {
    for (const proc of processes.values()) if (isRunning(proc)) killTree(proc, "SIGTERM");
  });
}

/** Start `command` in the background and wait briefly for early output. */
export async function startBackgroundProcess(
  command: string,
  cwd: string,
  startupWaitMs = STARTUP_WAIT_MS,
): Promise<BackgroundProcess> {
  const running = [...processes.values()].filter(isRunning).length;
  if (running >= MAX_RUNNING) {
    throw new Error(
      `${running} background processes are already running; stop one with the process tool first.`,
    );
  }
  installExitHook();
  const child = spawn(command, {
    cwd,
    shell: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CI: process.env.CI ?? "1" },
  });
  const id = `bg${nextId++}`;
  let resolveExit: () => void = () => {};
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });
  const proc: BackgroundProcess = {
    id,
    command,
    cwd,
    pid: child.pid,
    startedAt: Date.now(),
    exitCode: null,
    signal: null,
    output: "",
    received: 0,
    readUpTo: 0,
    child,
    exited,
  };
  const append = (chunk: Buffer | string) => {
    const text = chunk.toString();
    proc.received += text.length;
    proc.output += text;
    if (proc.output.length > MAX_BUFFER_CHARS) proc.output = proc.output.slice(-MAX_BUFFER_CHARS);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  child.on("error", (err) => {
    append(`\n[failed to start: ${err.message}]\n`);
    if (proc.exitCode === null) proc.exitCode = -1;
    resolveExit();
  });
  child.on("exit", (code, signal) => {
    proc.exitCode = code;
    proc.signal = signal;
    resolveExit();
  });
  // Don't keep lucky alive just for a child it will kill on exit anyway (a
  // headless `lucky run` must still exit when its turn ends).
  child.unref();
  for (const stream of [child.stdout, child.stderr]) {
    (stream as unknown as { unref?: () => void } | null)?.unref?.();
  }
  processes.set(id, proc);

  await Promise.race([exited, sleep(startupWaitMs)]);
  return proc;
}

/** New output since the last read (tail-trimmed), advancing the read mark. */
export function readNewOutput(proc: BackgroundProcess): { text: string; skipped: number } {
  const bufferStart = proc.received - proc.output.length;
  const from = Math.max(proc.readUpTo, bufferStart);
  let text = proc.output.slice(from - bufferStart);
  let skipped = from - proc.readUpTo;
  if (text.length > MAX_READ_CHARS) {
    skipped += text.length - MAX_READ_CHARS;
    text = text.slice(-MAX_READ_CHARS);
  }
  proc.readUpTo = proc.received;
  return { text, skipped };
}

export function describeProcess(proc: BackgroundProcess): string {
  const seconds = Math.round((Date.now() - proc.startedAt) / 1000);
  const state = isRunning(proc)
    ? `running · pid ${proc.pid ?? "?"}`
    : proc.signal
      ? `stopped (${proc.signal})`
      : `exited ${proc.exitCode}`;
  return `[${proc.id} · ${state} · ${seconds}s] ${proc.command}`;
}

function formatRead(proc: BackgroundProcess): string {
  const { text, skipped } = readNewOutput(proc);
  const body = text.trim() ? text.trimEnd() : "(no new output)";
  const note = skipped > 0 ? `[${skipped} earlier chars not shown]\n` : "";
  return `${describeProcess(proc)}\n${note}${body}`;
}

/** Result text for `exec` with background: true. */
export function formatStarted(proc: BackgroundProcess): string {
  const hint = isRunning(proc)
    ? `\nStill running in the background. Read its output or stop it with the process tool (id "${proc.id}").`
    : "";
  return `${formatRead(proc)}${hint}`;
}

export async function stopBackgroundProcess(proc: BackgroundProcess): Promise<void> {
  if (!isRunning(proc)) return;
  killTree(proc, "SIGTERM");
  const stopped = await Promise.race([proc.exited.then(() => true), sleep(STOP_GRACE_MS).then(() => false)]);
  if (!stopped) {
    killTree(proc, "SIGKILL");
    await Promise.race([proc.exited, sleep(1_000)]);
  }
}

/** Test hook: stop and forget every background process. */
export async function resetBackgroundProcesses(): Promise<void> {
  await Promise.all([...processes.values()].map(stopBackgroundProcess));
  processes.clear();
}

export const processTool = defineTool({
  name: "process",
  description:
    "Manage commands started with exec + background: true. 'list' shows them all; " +
    "'output' returns what a process printed since the last read (optionally waiting " +
    "up to waitMs for more, e.g. until a dev server reports it's ready); 'stop' " +
    "terminates it and its children. Only processes this session started are visible.",
  // Reads and stops only processes the user already approved starting.
  readonly: true,
  schema: z.object({
    action: z.enum(["list", "output", "stop"]),
    id: z.string().optional().describe("Process id from exec, e.g. \"bg1\" (required for output/stop)."),
    waitMs: z
      .number()
      .int()
      .min(0)
      .max(30_000)
      .optional()
      .describe("For 'output': wait up to this long for new output or exit (default 0)."),
  }),
  async execute({ action, id, waitMs }) {
    if (action === "list") {
      if (processes.size === 0) return { content: "No background processes." };
      return { content: [...processes.values()].map(describeProcess).join("\n") };
    }
    const proc = id ? processes.get(id) : undefined;
    if (!proc) {
      const known = [...processes.keys()].join(", ") || "none";
      return { content: `Unknown process id "${id ?? ""}". Known: ${known}.`, isError: true };
    }
    if (action === "stop") {
      await stopBackgroundProcess(proc);
      return { content: formatRead(proc) };
    }
    if (waitMs && isRunning(proc) && proc.received === proc.readUpTo) {
      await waitForOutput(proc, waitMs);
    }
    return { content: formatRead(proc) };
  },
});

async function waitForOutput(proc: BackgroundProcess, waitMs: number): Promise<void> {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline && isRunning(proc) && proc.received === proc.readUpTo) {
    await Promise.race([proc.exited, sleep(100)]);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

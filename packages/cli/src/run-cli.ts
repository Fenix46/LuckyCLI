import { readFile } from "node:fs/promises";
import { resolveConfig, type Agent, type ResolvedConfig } from "@luckycli/core";
import { buildAgent } from "./runtime.js";
import { formatMachineEvent, parseOutputFormat, type OutputFormat } from "./output.js";

export const RUN_EXIT_CODES = {
  success: 0,
  failure: 1,
  cancelled: 2,
  setupRequired: 3,
} as const;

export interface RunCommandIO {
  out?: (text: string) => void;
  err?: (text: string) => void;
  stdin?: () => Promise<string>;
  resolve?: typeof resolveConfig;
  build?: (config: ResolvedConfig) => Agent;
}

/** Execute one agent turn without opening setup, approval, or other prompts. */
export async function runCommand(args: string[], io: RunCommandIO = {}): Promise<number> {
  const out = io.out ?? ((text: string) => process.stdout.write(text));
  const err = io.err ?? ((text: string) => process.stderr.write(text));
  let prompt: string;
  let flags: { provider?: string; model?: string; file?: string; help?: boolean; nonInteractive?: boolean; format?: OutputFormat };
  try {
    const parsed = parseRunArgs(args);
    flags = parsed.flags;
    prompt = parsed.prompt;
  } catch (error) {
    err(`${error instanceof Error ? error.message : String(error)}\n`);
    return RUN_EXIT_CODES.failure;
  }
  let format: OutputFormat;
  try { format = parseOutputFormat(flags.format); } catch (error) {
    err(`${error instanceof Error ? error.message : String(error)}\n`);
    return RUN_EXIT_CODES.failure;
  }
  if (flags.help) {
    out("Usage: lucky run [options] <prompt>\n       lucky run --file <path>\n       lucky run  # reads prompt from stdin\n");
    return RUN_EXIT_CODES.success;
  }
  if (flags.file && prompt) {
    err("provide either a prompt or --file, not both\n");
    return RUN_EXIT_CODES.failure;
  }
  if (flags.file) {
    try { prompt = (await readFile(flags.file, "utf8")).trim(); } catch (error) {
      err(`unable to read prompt file: ${error instanceof Error ? error.message : String(error)}\n`);
      return RUN_EXIT_CODES.failure;
    }
  } else if (!prompt) {
    if (io.stdin) prompt = (await io.stdin()).trim();
    else if (!process.stdin.isTTY) prompt = (await readStdin()).trim();
  }
  if (!prompt) {
    err("a prompt is required (inline, --file, or stdin)\n");
    return RUN_EXIT_CODES.failure;
  }

  let config: ResolvedConfig;
  try {
    config = (io.resolve ?? resolveConfig)({
      ...(flags.provider ? { provider: flags.provider } : {}),
      ...(flags.model ? { model: flags.model } : {}),
    });
  } catch (error) {
    err(`${error instanceof Error ? error.message : String(error)}\n`);
    return RUN_EXIT_CODES.setupRequired;
  }
  if (config.needsSetup || !config.provider || !config.model || !config.credentials) {
    err("provider setup is required; run lucky interactively before using lucky run\n");
    return RUN_EXIT_CODES.setupRequired;
  }

  const agent = (io.build ?? ((resolved) => buildAgent({
    provider: resolved.provider!,
    model: resolved.model!,
    credentials: resolved.credentials!,
    system: resolved.system,
    temperature: resolved.temperature,
    maxTokens: resolved.maxTokens,
    reasoningEffort: resolved.reasoningEffort,
    thinkingEnabled: resolved.thinkingEnabled,
    permissions: resolved.permissions,
    approveTool: () => "deny",
    askUser: async () => { throw new Error("interactive questions are disabled in lucky run"); },
  })))(config);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let failed = false;
  let output = "";
  const emit = (text: string) => {
    if (format === "text") out(text);
    else output += text;
  };
  try {
    for await (const event of agent.send(prompt, controller.signal)) {
      if (event.type === "text") {
        emit(event.delta);
        if (format === "jsonl") out(`${formatMachineEvent({ type: "text", delta: event.delta })}\n`);
      }
      if (event.type === "error" || (event.type === "tool_end" && event.isError)) {
        failed = true;
        const message = event.type === "error" ? event.message : event.content;
        if (format === "text") err(`${message}\n`);
        else if (format === "jsonl") out(`${formatMachineEvent({ type: "error", message })}\n`);
      }
      if (event.type === "aborted") {
        if (format === "json") out(`${formatMachineEvent({ type: "result", command: "run", status: "cancelled", output })}\n`);
        else if (format === "jsonl") out(`${formatMachineEvent({ type: "result", command: "run", status: "cancelled" })}\n`);
        return RUN_EXIT_CODES.cancelled;
      }
    }
    const status = failed ? "failed" : "passed";
    if (format === "json") out(`${formatMachineEvent({ type: "result", command: "run", status, output })}\n`);
    else if (format === "jsonl") out(`${formatMachineEvent({ type: "result", command: "run", status })}\n`);
    return failed ? RUN_EXIT_CODES.failure : RUN_EXIT_CODES.success;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (format === "text") err(`${message}\n`);
    else out(`${formatMachineEvent({ type: "error", command: "run", message })}\n`);
    return controller.signal.aborted ? RUN_EXIT_CODES.cancelled : RUN_EXIT_CODES.failure;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

function parseRunArgs(args: string[]): { flags: { provider?: string; model?: string; file?: string; help?: boolean; nonInteractive?: boolean; format?: OutputFormat }; prompt: string } {
  const flags: { provider?: string; model?: string; file?: string; help?: boolean; nonInteractive?: boolean; format?: OutputFormat } = {};
  const promptParts: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg === "--non-interactive") flags.nonInteractive = true;
    else if (arg === "--format") flags.format = requiredValue(args, ++i, arg) as OutputFormat;
    else if (arg === "--provider" || arg === "-p") flags.provider = requiredValue(args, ++i, arg);
    else if (arg === "--model" || arg === "-m") flags.model = requiredValue(args, ++i, arg);
    else if (arg === "--file" || arg === "-f") flags.file = requiredValue(args, ++i, arg);
    else if (arg.startsWith("-")) throw new Error(`unknown run option: ${arg}`);
    else promptParts.push(arg);
  }
  return { flags, prompt: promptParts.join(" ").trim() };
}

function requiredValue(args: string[], index: number, option: string): string {
  const value = args[index];
  if (!value || value.startsWith("-")) throw new Error(`${option} requires a value`);
  return value;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

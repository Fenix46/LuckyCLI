import { spawn } from "node:child_process";
import type {
  HookConfig,
  HookEvent,
  HookHandler,
  HookInput,
  HookMatcher,
  HookResult,
  HookRunner,
  HookCommand,
  HookHttp,
  HookPrompt,
} from "./types.js";

const DEFAULT_TIMEOUT_SECONDS = 60;
const MAX_CAPTURE_CHARS = 1_000_000;

export interface HookRunnerOptions {
  cwd: string;
  /** Stable conversation id exposed to hooks as session_id. */
  sessionId?: string;
  env?: NodeJS.ProcessEnv;
  /** Hard kill switch, e.g. LUCKY_DISABLE_HOOKS. */
  disabled?: boolean;
}

interface HandlerOutcome {
  blocked: boolean;
  reason?: string;
  additionalContext?: string;
  updatedInput?: Record<string, unknown>;
}

/**
 * Build a runner for a hook config. Hooks are matched, then executed in order.
 * A blocking handler stops the chain; context and input rewrites from earlier
 * handlers are kept. Handler failures are warnings, never crashes: a broken
 * formatter must not break the agent loop.
 */
export function createHookRunner(config: HookConfig, opts: HookRunnerOptions): HookRunner {
  const env = opts.env ?? process.env;
  const disabled = opts.disabled || isTruthy(env.LUCKY_DISABLE_HOOKS);

  return {
    has(event: HookEvent): boolean {
      if (disabled) return false;
      return (config[event]?.length ?? 0) > 0;
    },

    async run(event, payload): Promise<HookResult> {
      const warnings: string[] = [];
      if (disabled) return { blocked: false, warnings };
      const matchers = config[event] ?? [];
      const input: HookInput = {
        session_id: opts.sessionId ?? "lucky",
        cwd: opts.cwd,
        hook_event_name: event,
        ...(payload.toolName !== undefined ? { tool_name: payload.toolName } : {}),
        ...(payload.toolInput !== undefined ? { tool_input: payload.toolInput } : {}),
        ...(payload.toolResponse !== undefined ? { tool_response: payload.toolResponse } : {}),
        ...(payload.prompt !== undefined ? { prompt: payload.prompt } : {}),
        ...(payload.source !== undefined ? { source: payload.source } : {}),
      };

      let additionalContext: string | undefined;
      let updatedInput: Record<string, unknown> | undefined;

      for (const matcher of matchers) {
        if (!matcherMatches(matcher, event, payload.toolName, payload.source)) continue;
        for (const handler of matcher.hooks) {
          const outcome = await runHandler(handler, input, opts.cwd, env);
          if (outcome.warning) warnings.push(outcome.warning);
          if (outcome.additionalContext) {
            additionalContext = additionalContext
              ? `${additionalContext}\n${outcome.additionalContext}`
              : outcome.additionalContext;
          }
          if (outcome.updatedInput) updatedInput = { ...updatedInput, ...outcome.updatedInput };
          if (outcome.blocked) {
            return {
              blocked: true,
              ...(outcome.reason ? { reason: outcome.reason } : {}),
              ...(additionalContext ? { additionalContext } : {}),
              ...(updatedInput ? { updatedInput } : {}),
              warnings,
            };
          }
        }
      }

      return {
        blocked: false,
        ...(additionalContext ? { additionalContext } : {}),
        ...(updatedInput ? { updatedInput } : {}),
        warnings,
      };
    },
  };
}

function matcherMatches(
  matcher: HookMatcher,
  event: HookEvent,
  toolName: string | undefined,
  source: string | undefined,
): boolean {
  const pattern = matcher.matcher?.trim();
  if (!pattern || pattern === "*") return true;
  const subject = toolName ?? source ?? "";
  try {
    return new RegExp(pattern).test(subject);
  } catch {
    return false;
  }
}

type HandlerOutcomeWithWarning = HandlerOutcome & { warning?: string };

async function runHandler(
  handler: HookHandler,
  input: HookInput,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<HandlerOutcomeWithWarning> {
  switch (handler.type) {
    case "command":
      return runCommandHandler(handler, input, cwd, env);
    case "http":
      return runHttpHandler(handler, input);
    case "prompt":
      return { blocked: false, additionalContext: handler.prompt };
    default:
      return {
        blocked: false,
        warning: `Unsupported hook type "${(handler as { type?: string }).type ?? "unknown"}".`,
      };
  }
}

function runCommandHandler(
  handler: HookCommand,
  input: HookInput,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<HandlerOutcomeWithWarning> {
  return new Promise((resolve) => {
    const timeoutMs = toTimeoutMs(handler.timeout);
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const child = spawn(handler.command, {
      shell: true,
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const finish = (code: number | null, spawnError?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (spawnError) {
        resolve({ blocked: false, warning: `Hook command failed: ${spawnError.message}` });
        return;
      }
      if (timedOut) {
        resolve({
          blocked: false,
          warning: `Hook command timed out after ${handler.timeout ?? DEFAULT_TIMEOUT_SECONDS}s.`,
        });
        return;
      }
      const parsed = parseHookStdout(stdout);
      if (code === 2) {
        resolve({
          blocked: true,
          reason: parsed?.outcome.reason ?? stderr.trim() ?? "Blocked by hook.",
          ...(parsed?.outcome.additionalContext
            ? { additionalContext: parsed.outcome.additionalContext }
            : {}),
          ...(parsed?.outcome.updatedInput ? { updatedInput: parsed.outcome.updatedInput } : {}),
        });
        return;
      }
      if (parsed) {
        resolve({ ...parsed.outcome, ...(parsed.warning ? { warning: parsed.warning } : {}) });
        return;
      }
      if (code !== 0) {
        resolve({
          blocked: false,
          warning: `Hook command exited with code ${code ?? "unknown"}: ${stderr.trim() || stdout.trim() || "no output"}`,
        });
        return;
      }
      resolve({ blocked: false });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_CAPTURE_CHARS) stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_CAPTURE_CHARS) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => finish(null, error));
    child.on("close", (code) => finish(code));

    child.stdin?.end(`${JSON.stringify(input)}\n`);
  });
}

async function runHttpHandler(
  handler: HookHttp,
  input: HookInput,
): Promise<HandlerOutcomeWithWarning> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), toTimeoutMs(handler.timeout));
  timer.unref?.();
  try {
    const response = await fetch(handler.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...handler.headers },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      return {
        blocked: false,
        warning: `Hook HTTP ${handler.url} answered ${response.status}: ${text.slice(0, 300)}`,
      };
    }
    const parsed = parseHookStdout(text);
    return parsed ? { ...parsed.outcome, ...(parsed.warning ? { warning: parsed.warning } : {}) } : { blocked: false };
  } catch (error) {
    return {
      blocked: false,
      warning: `Hook HTTP ${handler.url} failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

interface ParsedHook {
  outcome: HandlerOutcome;
  warning?: string;
}

/**
 * Accept both Lucky's flat shape and Claude Code's `hookSpecificOutput`
 * envelope, so a hook written for Claude Code mostly keeps working.
 */
export function parseHookStdout(text: string): ParsedHook | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return { outcome: { blocked: false }, warning: `Hook printed non-JSON output: ${trimmed.slice(0, 200)}` };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { outcome: { blocked: false }, warning: "Hook JSON output was not an object." };
  }
  const record = value as Record<string, unknown>;
  const specific =
    typeof record.hookSpecificOutput === "object" && record.hookSpecificOutput !== null
      ? (record.hookSpecificOutput as Record<string, unknown>)
      : undefined;

  const permission = specific?.permissionDecision;
  const blocked =
    record.decision === "block" ||
    permission === "deny" ||
    record.continue === false;
  const reason =
    asString(record.reason) ??
    asString(specific?.permissionDecisionReason) ??
    asString(record.stopReason);
  const additionalContext =
    asString(record.additionalContext) ?? asString(specific?.additionalContext);
  const updatedInput = asRecord(record.updatedInput);

  const warning = asString(record.systemMessage);
  return {
    outcome: {
      blocked,
      ...(reason ? { reason } : {}),
      ...(additionalContext ? { additionalContext } : {}),
      ...(updatedInput ? { updatedInput } : {}),
    },
    ...(warning ? { warning } : {}),
  };
}

function toTimeoutMs(seconds: number | undefined): number {
  const value = seconds === undefined || !Number.isFinite(seconds) || seconds <= 0
    ? DEFAULT_TIMEOUT_SECONDS
    : Math.min(seconds, 600);
  return value * 1000;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

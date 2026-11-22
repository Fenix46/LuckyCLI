import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadStoredConfig } from "../config/store.js";
import { isHookEvent, type HookConfig, type HookEvent, type HookHandler, type HookMatcher } from "./types.js";

export interface HookConfigSource {
  path: string;
  events: number;
}

export interface LoadedHookConfig {
  config: HookConfig;
  sources: HookConfigSource[];
  errors: string[];
  disabled: boolean;
}

/**
 * Hooks come from two places, merged in order: the global config
 * (`~/.luckycli/config.json` → `hooks`) and a project file
 * (`.lucky/hooks.json`). Both use the same shape. The project file is
 * gitignored, so a cloned repository cannot inject hooks through it.
 *
 * `LUCKY_HOOKS_FILE` replaces the project file (useful for tests and for a
 * shared team config checked into the repo on purpose).
 */
export function loadHookConfig(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  /** Global hooks; tests pass them explicitly instead of touching ~/.luckycli. */
  globalHooks: HookConfig | undefined = loadStoredConfig().hooks,
): LoadedHookConfig {
  const errors: string[] = [];
  const sources: HookConfigSource[] = [];
  const merged: HookConfig = {};
  let events = 0;

  const add = (config: HookConfig | undefined, path: string) => {
    if (!config) return;
    let added = 0;
    for (const [event, matchers] of Object.entries(config)) {
      if (!isHookEvent(event)) {
        errors.push(`${path}: unknown hook event "${event}".`);
        continue;
      }
      if (!Array.isArray(matchers)) {
        errors.push(`${path}: "${event}" must be an array.`);
        continue;
      }
      const valid = matchers.flatMap((matcher, index) => validateMatcher(matcher, `${path}: ${event}[${index}]`, errors));
      if (valid.length === 0) continue;
      const list = (merged[event as HookEvent] ??= []);
      list.push(...valid);
      added += valid.length;
      events += valid.length;
    }
    if (added > 0) sources.push({ path, events: added });
  };

  add(globalHooks, "~/.luckycli/config.json");

  const projectPath = env.LUCKY_HOOKS_FILE?.trim() || join(cwd, ".lucky", "hooks.json");
  if (existsSync(projectPath)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(projectPath, "utf8"));
      const maybeWrapped =
        typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && "hooks" in parsed
          ? (parsed as { hooks: unknown }).hooks
          : parsed;
      if (typeof maybeWrapped !== "object" || maybeWrapped === null || Array.isArray(maybeWrapped)) {
        errors.push(`${projectPath}: expected an object of hook events.`);
      } else {
        add(maybeWrapped as HookConfig, projectPath);
      }
    } catch (error) {
      errors.push(`${projectPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    config: merged,
    sources,
    errors,
    disabled: isTruthy(env.LUCKY_DISABLE_HOOKS),
  };
}

/** One row per event, for `/hooks`. */
export function describeHookConfig(config: HookConfig): Array<{
  event: HookEvent;
  matchers: string[];
  handlers: number;
}> {
  return (Object.keys(config) as HookEvent[])
    .sort()
    .map((event) => {
      const matchers = config[event] ?? [];
      return {
        event,
        matchers: matchers.map((matcher) => matcher.matcher?.trim() || "*"),
        handlers: matchers.reduce((sum, matcher) => sum + matcher.hooks.length, 0),
      };
    });
}

function validateMatcher(
  value: unknown,
  label: string,
  errors: string[],
): HookMatcher[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push(`${label}: expected an object.`);
    return [];
  }
  const record = value as Record<string, unknown>;
  if (record.matcher !== undefined && typeof record.matcher !== "string") {
    errors.push(`${label}.matcher: expected a string.`);
  }
  if (!Array.isArray(record.hooks) || record.hooks.length === 0) {
    errors.push(`${label}.hooks: expected a non-empty array.`);
    return [];
  }
  const handlers = record.hooks.flatMap((handler, index) =>
    validateHandler(handler, `${label}.hooks[${index}]`, errors),
  );
  if (handlers.length === 0) return [];
  return [
    {
      ...(typeof record.matcher === "string" && record.matcher.trim()
        ? { matcher: record.matcher.trim() }
        : {}),
      hooks: handlers,
    },
  ];
}

function validateHandler(
  value: unknown,
  label: string,
  errors: string[],
): HookHandler[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push(`${label}: expected an object.`);
    return [];
  }
  const record = value as Record<string, unknown>;
  const type = record.type;
  if (type === "command") {
    if (typeof record.command !== "string" || !record.command.trim()) {
      errors.push(`${label}.command: expected a non-empty string.`);
      return [];
    }
    return [
      {
        type: "command",
        command: record.command,
        ...(finiteSeconds(record.timeout) ? { timeout: record.timeout } : {}),
      },
    ];
  }
  if (type === "http") {
    if (typeof record.url !== "string" || !record.url.trim()) {
      errors.push(`${label}.url: expected a non-empty string.`);
      return [];
    }
    return [
      {
        type: "http",
        url: record.url,
        ...(isStringRecord(record.headers) ? { headers: record.headers } : {}),
        ...(finiteSeconds(record.timeout) ? { timeout: record.timeout } : {}),
      },
    ];
  }
  if (type === "prompt") {
    if (typeof record.prompt !== "string" || !record.prompt.trim()) {
      errors.push(`${label}.prompt: expected a non-empty string.`);
      return [];
    }
    return [{ type: "prompt", prompt: record.prompt }];
  }
  errors.push(`${label}.type: expected "command", "http" or "prompt".`);
  return [];
}

function finiteSeconds(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

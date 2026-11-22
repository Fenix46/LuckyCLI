import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadStoredConfig } from "../config/store.js";
import type { LspConfig, LspServerConfig, LoadedLspConfig } from "./types.js";

/**
 * Language servers come from the global config (`~/.luckycli/config.json` →
 * `lsp`) and from a project `.lsp.json`, merged by name with the project
 * winning. `LUCKY_LSP_FILE` replaces the project file.
 *
 * Accepted project shapes:
 *   { "<name>": { "command": ..., ... } }
 *   { "lspServers": { "<name>": ... } }
 *   { "servers": { "<name>": ... } }
 */
export function loadLspConfig(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  globalConfig: LspConfig | undefined = loadStoredConfig().lsp,
): LoadedLspConfig {
  const config: LspConfig = {};
  const sources: string[] = [];
  const errors: string[] = [];

  if (globalConfig) {
    const valid = validateServers(globalConfig, "~/.luckycli/config.json", errors);
    if (Object.keys(valid).length > 0) {
      Object.assign(config, valid);
      sources.push("~/.luckycli/config.json");
    }
  }

  const projectPath = env.LUCKY_LSP_FILE?.trim() || join(cwd, ".lsp.json");
  if (existsSync(projectPath)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(projectPath, "utf8"));
      const wrapped = asRecord(parsed);
      const servers = wrapped && (asRecord(wrapped.lspServers) ?? asRecord(wrapped.servers));
      const candidate = servers ?? wrapped;
      if (!candidate) {
        errors.push(`${projectPath}: expected an object of language servers.`);
      } else {
        const valid = validateServers(candidate, projectPath, errors);
        if (Object.keys(valid).length > 0) {
          Object.assign(config, valid);
          sources.push(projectPath);
        }
      }
    } catch (error) {
      errors.push(`${projectPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { config, sources, errors };
}

function validateServers(
  value: LspConfig | Record<string, unknown>,
  path: string,
  errors: string[],
): LspConfig {
  const out: LspConfig = {};
  for (const [name, raw] of Object.entries(value)) {
    const record = asRecord(raw);
    if (!record) {
      errors.push(`${path}: server "${name}" must be an object.`);
      continue;
    }
    if (typeof record.command !== "string" || !record.command.trim()) {
      errors.push(`${path}: server "${name}" needs a command.`);
      continue;
    }
    if (record.args !== undefined && !isStringArray(record.args)) {
      errors.push(`${path}: server "${name}".args must be an array of strings.`);
      continue;
    }
    if (record.env !== undefined && !isStringRecord(record.env)) {
      errors.push(`${path}: server "${name}".env must be an object of strings.`);
      continue;
    }
    const extensionToLanguage =
      record.extensionToLanguage === undefined
        ? undefined
        : stringRecord(record.extensionToLanguage);
    if (record.extensionToLanguage !== undefined && !extensionToLanguage) {
      errors.push(`${path}: server "${name}".extensionToLanguage must map extensions to language ids.`);
      continue;
    }
    const fileExtensions =
      record.fileExtensions === undefined ? undefined : stringArray(record.fileExtensions);
    if (record.fileExtensions !== undefined && !fileExtensions) {
      errors.push(`${path}: server "${name}".fileExtensions must be an array of strings.`);
      continue;
    }
    if (!extensionToLanguage && !fileExtensions) {
      errors.push(`${path}: server "${name}" needs extensionToLanguage or fileExtensions.`);
      continue;
    }
    out[name] = {
      command: record.command,
      ...(Array.isArray(record.args) ? { args: record.args as string[] } : {}),
      ...(isStringRecord(record.env) ? { env: record.env } : {}),
      ...(record.transport === "stdio" ? { transport: "stdio" as const } : {}),
      ...(record.initializationOptions !== undefined
        ? { initializationOptions: record.initializationOptions }
        : {}),
      ...(asRecord(record.settings) ? { settings: record.settings as Record<string, unknown> } : {}),
      ...(extensionToLanguage ? { extensionToLanguage } : {}),
      ...(fileExtensions ? { fileExtensions } : {}),
      ...(typeof record.timeoutMs === "number" && record.timeoutMs > 0
        ? { timeoutMs: record.timeoutMs }
        : {}),
    };
  }
  return out;
}

/** Extensions a server claims, normalized with a leading dot. */
export function serverExtensions(server: LspServerConfig): string[] {
  const fromMap = Object.keys(server.extensionToLanguage ?? {});
  return [...new Set([...fromMap, ...(server.fileExtensions ?? [])])].map((extension) =>
    extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`,
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function stringArray(value: unknown): string[] | undefined {
  return isStringArray(value) ? value : undefined;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecordOfStrings(value);
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  return isRecordOfStrings(value) ? value : undefined;
}

function isRecordOfStrings(value: unknown): value is Record<string, string> {
  const record = asRecord(value);
  return Boolean(record) && Object.values(record!).every((entry) => typeof entry === "string");
}

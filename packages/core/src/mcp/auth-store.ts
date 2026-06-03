/**
 * Persistent storage for MCP OAuth credentials.
 *
 * Kept in a dedicated file (not the main config) because it holds access and
 * refresh tokens: it's written 0600 and is separable from the base config so a
 * config dump can be shared without leaking secrets. The entry shape mirrors
 * what the SDK's OAuthClientProvider needs to persist between runs — client
 * registration, tokens, and the in-flight PKCE verifier — so the OAuth flow can
 * sit directly on top of this store.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

export interface McpAuthEntry {
  /** Client registration (from dynamic registration or pre-provisioning). */
  clientInformation?: OAuthClientInformationFull;
  /** Issued OAuth tokens. */
  tokens?: OAuthTokens;
  /** PKCE code verifier for an in-flight authorization, cleared once redeemed. */
  codeVerifier?: string;
}

export interface McpAuthStore {
  /** Auth state keyed by logical MCP server name. */
  servers: Record<string, McpAuthEntry>;
}

export function mcpAuthFilePath(): string {
  return join(homedir(), ".luckycli", "mcp-auth.json");
}

export function loadMcpAuthStore(path = mcpAuthFilePath()): McpAuthStore {
  try {
    if (!existsSync(path)) return { servers: {} };
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<McpAuthStore>;
    return { servers: parsed.servers ?? {} };
  } catch {
    return { servers: {} };
  }
}

export function saveMcpAuthStore(store: McpAuthStore, path = mcpAuthFilePath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  try {
    chmodSync(path, 0o600);
  } catch {
    // best-effort on platforms without POSIX permissions
  }
}

export function getMcpAuthEntry(name: string, path = mcpAuthFilePath()): McpAuthEntry {
  return loadMcpAuthStore(path).servers[name] ?? {};
}

/** Merge a partial entry into a server's stored auth state and persist it. */
export function updateMcpAuthEntry(
  name: string,
  patch: Partial<McpAuthEntry>,
  path = mcpAuthFilePath(),
): McpAuthEntry {
  const store = loadMcpAuthStore(path);
  const next: McpAuthEntry = { ...(store.servers[name] ?? {}), ...patch };
  store.servers[name] = next;
  saveMcpAuthStore(store, path);
  return next;
}

/** Forget all stored auth for a server (logout). */
export function clearMcpAuthEntry(name: string, path = mcpAuthFilePath()): void {
  const store = loadMcpAuthStore(path);
  if (!store.servers[name]) return;
  delete store.servers[name];
  saveMcpAuthStore(store, path);
}

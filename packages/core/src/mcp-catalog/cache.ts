/**
 * On-disk cache for resolved MCP catalog metadata.
 *
 * Resolving a server detail hits the network (the official registry). Caching
 * those resolutions means a previously seen server can be installed/inspected
 * again without a round trip, and — when the registry is unreachable — a stale
 * entry is still better than a hard failure.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { CatalogSearchResult, CatalogServerDetail } from "./types.js";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 1 day

export interface CachedCatalogEntry {
  detail: CatalogServerDetail;
  /** Epoch ms when this entry was fetched. */
  fetchedAt: number;
}

export interface McpCatalogCacheData {
  servers: Record<string, CachedCatalogEntry>;
}

/** Minimal shape of a catalog the cache can wrap. */
export interface McpCatalogSource {
  get(name: string): Promise<CatalogServerDetail>;
  search(query: string): Promise<CatalogSearchResult>;
}

export function catalogCacheFilePath(): string {
  return join(homedir(), ".luckycli", "mcp-catalog-cache.json");
}

export function loadCatalogCache(path = catalogCacheFilePath()): McpCatalogCacheData {
  try {
    if (!existsSync(path)) return { servers: {} };
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<McpCatalogCacheData>;
    return { servers: parsed.servers ?? {} };
  } catch {
    return { servers: {} };
  }
}

export function saveCatalogCache(data: McpCatalogCacheData, path = catalogCacheFilePath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function isEntryFresh(
  entry: CachedCatalogEntry,
  ttlMs = DEFAULT_TTL_MS,
  now = Date.now(),
): boolean {
  return now - entry.fetchedAt < ttlMs;
}

export interface CachedMcpCatalogOptions {
  path?: string;
  ttlMs?: number;
  now?: () => number;
}

/**
 * Wraps a catalog source so `get` is served from disk when fresh, refreshed
 * when stale, and — if the network fetch fails — falls back to any cached entry
 * (even a stale one) rather than throwing. `search` always passes through, since
 * results are query-specific and quickly go out of date.
 */
export class CachedMcpCatalog implements McpCatalogSource {
  private readonly path: string;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly source: McpCatalogSource,
    options: CachedMcpCatalogOptions = {},
  ) {
    this.path = options.path ?? catalogCacheFilePath();
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  async get(name: string): Promise<CatalogServerDetail> {
    const cache = loadCatalogCache(this.path);
    const entry = cache.servers[name];
    if (entry && isEntryFresh(entry, this.ttlMs, this.now())) {
      return entry.detail;
    }
    try {
      const detail = await this.source.get(name);
      cache.servers[name] = { detail, fetchedAt: this.now() };
      saveCatalogCache(cache, this.path);
      return detail;
    } catch (error) {
      if (entry) return entry.detail;
      throw error;
    }
  }

  search(query: string): Promise<CatalogSearchResult> {
    return this.source.search(query);
  }
}

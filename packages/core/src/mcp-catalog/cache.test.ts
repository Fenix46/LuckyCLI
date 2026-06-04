import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CachedMcpCatalog,
  isEntryFresh,
  loadCatalogCache,
  saveCatalogCache,
  type McpCatalogSource,
} from "./cache.js";
import type { CatalogSearchResult, CatalogServerDetail } from "./types.js";

const tmpDirs: string[] = [];

function tempCachePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "lucky-mcp-cache-"));
  tmpDirs.push(dir);
  return join(dir, "cache.json");
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("catalog cache store", () => {
  it("round-trips entries and returns empty on a missing file", () => {
    const path = tempCachePath();
    expect(loadCatalogCache(path)).toEqual({ servers: {} });

    saveCatalogCache({ servers: { foo: { detail: { name: "foo" }, fetchedAt: 10 } } }, path);
    expect(loadCatalogCache(path).servers.foo?.detail.name).toBe("foo");
  });

  it("treats entries past the ttl as stale", () => {
    const entry = { detail: { name: "foo" }, fetchedAt: 1_000 };
    expect(isEntryFresh(entry, 500, 1_400)).toBe(true); // 400ms old, ttl 500
    expect(isEntryFresh(entry, 500, 1_600)).toBe(false); // 600ms old, past ttl
    expect(isEntryFresh(entry, 5_000, 1_400)).toBe(true);
  });
});

describe("CachedMcpCatalog", () => {
  function fakeSource(detail: CatalogServerDetail): McpCatalogSource & { getCalls: number } {
    const source = {
      getCalls: 0,
      async get(): Promise<CatalogServerDetail> {
        source.getCalls += 1;
        return detail;
      },
      async search(): Promise<CatalogSearchResult> {
        return { items: [] };
      },
    };
    return source;
  }

  it("serves a fresh entry from cache without re-fetching", async () => {
    const path = tempCachePath();
    const source = fakeSource({ name: "docs", title: "Docs" });
    let now = 1_000;
    const catalog = new CachedMcpCatalog(source, { path, ttlMs: 10_000, now: () => now });

    await catalog.get("docs");
    now = 2_000; // still within ttl
    await catalog.get("docs");

    expect(source.getCalls).toBe(1);
  });

  it("falls back to a stale cached entry when the source fails", async () => {
    const path = tempCachePath();
    let now = 1_000;
    let shouldFail = false;
    const source: McpCatalogSource = {
      async get(): Promise<CatalogServerDetail> {
        if (shouldFail) throw new Error("network down");
        return { name: "docs", title: "Docs" };
      },
      async search(): Promise<CatalogSearchResult> {
        return { items: [] };
      },
    };
    const catalog = new CachedMcpCatalog(source, { path, ttlMs: 100, now: () => now });

    await catalog.get("docs"); // populates cache
    now = 10_000; // entry now stale
    shouldFail = true;

    const detail = await catalog.get("docs");
    expect(detail.title).toBe("Docs");
  });

  it("propagates the error when there is nothing cached", async () => {
    const path = tempCachePath();
    const source: McpCatalogSource = {
      async get(): Promise<CatalogServerDetail> {
        throw new Error("network down");
      },
      async search(): Promise<CatalogSearchResult> {
        return { items: [] };
      },
    };
    const catalog = new CachedMcpCatalog(source, { path });

    await expect(catalog.get("docs")).rejects.toThrow(/network down/);
  });
});

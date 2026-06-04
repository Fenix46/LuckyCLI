import type { CatalogSearchResult, CatalogServerDetail, CatalogServerSummary } from "./types.js";

const DEFAULT_BASE_URL = "https://registry.modelcontextprotocol.io";
const DEFAULT_PAGE_LIMIT = 100;
const DEFAULT_MAX_SCAN = 300;

type FetchLike = typeof fetch;

interface RegistryListResponse {
  servers?: unknown[];
  metadata?: {
    nextCursor?: string;
  };
}

export class OfficialMcpRegistryCatalog {
  constructor(
    private readonly options: {
      baseUrl?: string;
      fetchFn?: FetchLike;
      pageLimit?: number;
      maxScan?: number;
    } = {},
  ) {}

  async search(query: string): Promise<CatalogSearchResult> {
    const normalized = query.trim();
    if (!normalized) {
      return { items: (await this.listServers()).slice(0, 20) };
    }
    const url = new URL(`${this.baseUrl()}/v0.1/servers`);
    url.searchParams.set("limit", String(this.options.pageLimit ?? DEFAULT_PAGE_LIMIT));
    url.searchParams.set("search", normalized);
    const payload = normalizeListResponse(await this.fetchJson(url.toString()));
    return { items: payload.items.slice(0, 20) };
  }

  async get(name: string): Promise<CatalogServerDetail> {
    const encoded = encodeURIComponent(name);
    const response = await this.fetchJson(
      `${this.baseUrl()}/v0.1/servers/${encoded}/versions/latest`,
    );
    return normalizeServerDetail(response);
  }

  private async listServers(): Promise<CatalogServerSummary[]> {
    const pageLimit = this.options.pageLimit ?? DEFAULT_PAGE_LIMIT;
    const maxScan = this.options.maxScan ?? DEFAULT_MAX_SCAN;
    let cursor: string | undefined;
    const items: CatalogServerSummary[] = [];

    while (items.length < maxScan) {
      const url = new URL(`${this.baseUrl()}/v0.1/servers`);
      url.searchParams.set("limit", String(pageLimit));
      if (cursor) url.searchParams.set("cursor", cursor);
      const payload = normalizeListResponse(await this.fetchJson(url.toString()));
      items.push(...payload.items);
      if (!payload.nextCursor || payload.items.length === 0) break;
      cursor = payload.nextCursor;
    }

    return items;
  }

  private async fetchJson(url: string): Promise<unknown> {
    const fetchFn = this.options.fetchFn ?? fetch;
    const response = await fetchFn(url);
    if (!response.ok) {
      throw new Error(`Official MCP Registry request failed: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  private baseUrl(): string {
    return this.options.baseUrl ?? DEFAULT_BASE_URL;
  }
}

function normalizeListResponse(payload: unknown): {
  items: CatalogServerSummary[];
  nextCursor?: string;
} {
  const data = (payload ?? {}) as RegistryListResponse;
  return {
    items: Array.isArray(data.servers) ? data.servers.map(normalizeServerSummary) : [],
    ...(data.metadata?.nextCursor ? { nextCursor: data.metadata.nextCursor } : {}),
  };
}

function normalizeServerSummary(raw: unknown): CatalogServerSummary {
  const wrapper = (raw ?? {}) as Record<string, unknown>;
  const value =
    wrapper.server && typeof wrapper.server === "object"
      ? (wrapper.server as Record<string, unknown>)
      : wrapper;
  const meta = wrapper._meta as Record<string, unknown> | undefined;
  const officialMeta = meta?.["io.modelcontextprotocol.registry/official"] as Record<string, unknown> | undefined;
  return {
    name: String(value.name ?? ""),
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    ...(typeof value.description === "string" ? { description: value.description } : {}),
    ...(typeof value.version === "string" ? { version: value.version } : {}),
    ...(typeof value.status === "string"
      ? { status: value.status }
      : typeof officialMeta?.status === "string"
        ? { status: String(officialMeta.status) }
        : {}),
  };
}

function normalizeServerDetail(raw: unknown): CatalogServerDetail {
  const wrapper = (raw ?? {}) as Record<string, unknown>;
  const value =
    wrapper.server && typeof wrapper.server === "object"
      ? (wrapper.server as Record<string, unknown>)
      : wrapper;
  return {
    ...normalizeServerSummary(raw),
    ...(Array.isArray(value.packages)
      ? {
          packages: value.packages.map((entry) => {
            const item = (entry ?? {}) as Record<string, unknown>;
            return {
              ...(typeof item.registryType === "string" ? { registryType: item.registryType } : {}),
              ...(typeof item.identifier === "string" ? { identifier: item.identifier } : {}),
              ...(typeof item.version === "string" ? { version: item.version } : {}),
              ...(item.transport && typeof item.transport === "object"
                ? {
                    transport: {
                      type:
                        typeof (item.transport as Record<string, unknown>).type === "string"
                          ? String((item.transport as Record<string, unknown>).type)
                          : undefined,
                    },
                  }
                : {}),
            };
          }),
        }
      : {}),
    ...(Array.isArray(value.remotes)
      ? {
          remotes: value.remotes.map((entry) => {
            const item = (entry ?? {}) as Record<string, unknown>;
            return {
              ...(typeof item.type === "string" ? { type: item.type } : {}),
              ...(typeof item.url === "string" ? { url: item.url } : {}),
            };
          }),
        }
      : {}),
  };
}

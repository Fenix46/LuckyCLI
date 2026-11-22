import { z } from "zod";
import { defineTool } from "../types.js";

export type WebSearchProvider = "brave" | "tavily" | "custom";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchConfig {
  provider: WebSearchProvider;
  apiKey?: string;
  endpoint?: string;
}

export interface WebSearchOptions {
  count?: number;
  allowedDomains?: string[];
  blockedDomains?: string[];
}

type FetchLike = typeof fetch;

const DEFAULT_RESULTS = 5;
const MAX_RESULTS = 10;
const TIMEOUT_MS = 15_000;
const MAX_BODY_CHARS = 1_000_000;
const MAX_SNIPPET_CHARS = 500;

/**
 * Pick a search provider from the environment. Explicit
 * LUCKY_WEB_SEARCH_PROVIDER wins; otherwise the first configured key/endpoint
 * is used. No key means the tool is simply not configured, not broken.
 */
export function resolveWebSearchConfig(env: NodeJS.ProcessEnv = process.env): WebSearchConfig | undefined {
  const explicit = env.LUCKY_WEB_SEARCH_PROVIDER?.trim().toLowerCase();
  const brave = env.BRAVE_SEARCH_API_KEY?.trim();
  const tavily = env.TAVILY_API_KEY?.trim();
  const endpoint = env.LUCKY_WEB_SEARCH_URL?.trim();
  const key = env.LUCKY_WEB_SEARCH_API_KEY?.trim();

  if (explicit === "brave") return brave ? { provider: "brave", apiKey: brave } : undefined;
  if (explicit === "tavily") return tavily ? { provider: "tavily", apiKey: tavily } : undefined;
  if (explicit === "custom") {
    return endpoint ? { provider: "custom", endpoint, ...(key ? { apiKey: key } : {}) } : undefined;
  }
  if (brave) return { provider: "brave", apiKey: brave };
  if (tavily) return { provider: "tavily", apiKey: tavily };
  if (endpoint) return { provider: "custom", endpoint, ...(key ? { apiKey: key } : {}) };
  return undefined;
}

/** Run a web search through the configured provider. Throws on transport/HTTP errors. */
export async function searchWeb(
  query: string,
  config: WebSearchConfig,
  options: WebSearchOptions = {},
  fetchImpl: FetchLike = fetch,
): Promise<WebSearchResult[]> {
  const count = clampCount(options.count);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const raw =
      config.provider === "brave"
        ? await searchBrave(query, config, count, options, fetchImpl, controller.signal)
        : config.provider === "tavily"
          ? await searchTavily(query, config, count, options, fetchImpl, controller.signal)
          : await searchCustom(query, config, count, options, fetchImpl, controller.signal);
    return filterDomains(raw, options).slice(0, count);
  } finally {
    clearTimeout(timer);
  }
}

export const webSearchTool = defineTool({
  name: "web_search",
  description:
    "Search the web for current information and return titles, URLs and short " +
    "snippets. Use it when the answer depends on something newer than your " +
    "knowledge or outside the project. Requires a configured provider: " +
    "BRAVE_SEARCH_API_KEY, TAVILY_API_KEY, or LUCKY_WEB_SEARCH_URL.",
  readonly: true,
  concurrencySafe: true,
  schema: z.object({
    query: z.string().min(1).describe("Search query."),
    count: z
      .number()
      .int()
      .positive()
      .max(MAX_RESULTS)
      .optional()
      .describe(`Number of results (default ${DEFAULT_RESULTS}, max ${MAX_RESULTS}).`),
    allowed_domains: z
      .array(z.string())
      .optional()
      .describe("Only return results from these domains (and their subdomains)."),
    blocked_domains: z
      .array(z.string())
      .optional()
      .describe("Never return results from these domains (and their subdomains)."),
  }),
  async execute({ query, count, allowed_domains, blocked_domains }) {
    const config = resolveWebSearchConfig();
    if (!config) {
      return {
        content:
          "Web search is not configured. Set BRAVE_SEARCH_API_KEY, TAVILY_API_KEY, " +
          "or LUCKY_WEB_SEARCH_URL (with LUCKY_WEB_SEARCH_API_KEY) and try again.",
        isError: true,
      };
    }
    try {
      const results = await searchWeb(query, config, {
        ...(count !== undefined ? { count } : {}),
        ...(allowed_domains ? { allowedDomains: allowed_domains } : {}),
        ...(blocked_domains ? { blockedDomains: blocked_domains } : {}),
      });
      if (results.length === 0) {
        return { content: `No web results for "${query}".` };
      }
      const body = results
        .map((result, index) => `${index + 1}. ${result.title}\n   ${result.url}\n   ${result.snippet}`)
        .join("\n\n");
      return { content: body };
    } catch (error) {
      return {
        content: `Web search failed: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
  },
});

async function searchBrave(
  query: string,
  config: WebSearchConfig,
  count: number,
  _options: WebSearchOptions,
  fetchImpl: FetchLike,
  signal: AbortSignal,
): Promise<WebSearchResult[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(count));
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": config.apiKey ?? "",
    },
    signal,
  });
  const data = await readJson(response);
  const rows = asRecord(asRecord(data)?.web)?.results;
  return Array.isArray(rows) ? rows.flatMap(normalizeRow) : [];
}

async function searchTavily(
  query: string,
  config: WebSearchConfig,
  count: number,
  options: WebSearchOptions,
  fetchImpl: FetchLike,
  signal: AbortSignal,
): Promise<WebSearchResult[]> {
  const response = await fetchImpl("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: config.apiKey,
      query,
      max_results: count,
      ...(options.allowedDomains?.length ? { include_domains: options.allowedDomains } : {}),
      ...(options.blockedDomains?.length ? { exclude_domains: options.blockedDomains } : {}),
    }),
    signal,
  });
  const data = await readJson(response);
  const rows = asRecord(data)?.results;
  return Array.isArray(rows) ? rows.flatMap(normalizeRow) : [];
}

async function searchCustom(
  query: string,
  config: WebSearchConfig,
  count: number,
  options: WebSearchOptions,
  fetchImpl: FetchLike,
  signal: AbortSignal,
): Promise<WebSearchResult[]> {
  if (!config.endpoint) throw new Error("custom search endpoint is missing");
  const response = await fetchImpl(config.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      query,
      count,
      ...(options.allowedDomains?.length ? { allowed_domains: options.allowedDomains } : {}),
      ...(options.blockedDomains?.length ? { blocked_domains: options.blockedDomains } : {}),
    }),
    signal,
  });
  const data = await readJson(response);
  const record = asRecord(data);
  const rows = record?.results ?? asRecord(record?.web)?.results;
  return Array.isArray(rows) ? rows.flatMap(normalizeRow) : [];
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`search provider returned HTTP ${response.status}`);
  }
  const text = await response.text();
  if (text.length > MAX_BODY_CHARS) {
    throw new Error("search provider response is too large");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("search provider returned invalid JSON");
  }
}

function normalizeRow(row: unknown): WebSearchResult[] {
  const record = asRecord(row);
  if (!record) return [];
  const url = asString(record.url);
  if (!url) return [];
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return [];
  } catch {
    return [];
  }
  const title = asString(record.title) ?? url;
  const snippet =
    asString(record.description) ??
    asString(record.snippet) ??
    asString(record.content) ??
    "";
  return [
    {
      title: collapse(title).slice(0, 200) || url,
      url,
      snippet: collapse(snippet).slice(0, MAX_SNIPPET_CHARS),
    },
  ];
}

function filterDomains(results: WebSearchResult[], options: WebSearchOptions): WebSearchResult[] {
  const allowed = normalizeDomains(options.allowedDomains);
  const blocked = normalizeDomains(options.blockedDomains);
  if (allowed.length === 0 && blocked.length === 0) return results;
  return results.filter((result) => {
    let host: string;
    try {
      host = new URL(result.url).hostname.toLowerCase();
    } catch {
      return false;
    }
    if (blocked.some((domain) => hostMatches(host, domain))) return false;
    return allowed.length === 0 || allowed.some((domain) => hostMatches(host, domain));
  });
}

function normalizeDomains(domains: string[] | undefined): string[] {
  return (domains ?? [])
    .map((domain) => domain.trim().toLowerCase().replace(/^\.+/, ""))
    .filter(Boolean);
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function clampCount(count: number | undefined): number {
  if (count === undefined || !Number.isFinite(count)) return DEFAULT_RESULTS;
  return Math.min(MAX_RESULTS, Math.max(1, Math.floor(count)));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

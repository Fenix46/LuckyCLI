import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { z } from "zod";
import { defineTool } from "../types.js";
import { CORE_VERSION } from "../../version.js";

const MAX_BYTES = 80_000;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

export const httpFetchTool = defineTool({
  name: "http_fetch",
  description:
    "Fetch and read the text content of a public URL (e.g. to inspect documentation, APIs or pages). " +
    "HTML pages are converted to readable markdown-like text.",
  readonly: true,
  schema: z.object({
    url: z.string().url().describe("The complete HTTP or HTTPS URL to fetch."),
  }),
  async execute({ url }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetchPublicUrl(new URL(url), controller.signal);
      if (!res.ok) {
        return {
          content: `HTTP error! Status: ${res.status} ${res.statusText}`,
          isError: true,
        };
      }
      const { text, truncated } = await readLimitedText(res, MAX_BYTES);
      const rendered = renderFetchedText(text, res.headers.get("content-type"), new URL(url));
      return {
        content: truncated
          ? `${rendered}\n\n[truncated at ${MAX_BYTES} bytes]`
          : rendered,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Fetch failed: ${message}`, isError: true };
    } finally {
      clearTimeout(timeout);
    }
  },
});

async function fetchPublicUrl(
  url: URL,
  signal: AbortSignal,
  redirects = 0,
): Promise<Response> {
  await assertPublicHttpUrl(url);
  const res = await fetch(url, {
    redirect: "manual",
    signal,
    headers: {
      "User-Agent": `luckycli/${CORE_VERSION}`,
    },
  });

  if (isRedirect(res.status)) {
    if (redirects >= MAX_REDIRECTS) {
      throw new Error(`too many redirects (${MAX_REDIRECTS})`);
    }
    const location = res.headers.get("location");
    if (!location) throw new Error("redirect response missing Location header");
    return fetchPublicUrl(new URL(location, url), signal, redirects + 1);
  }
  return res;
}

async function assertPublicHttpUrl(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed.");
  }
  if (url.username || url.password) {
    throw new Error("URLs with embedded credentials are not allowed.");
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "metadata.google.internal"
  ) {
    throw new Error("Private or local URLs are not allowed.");
  }

  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });

  if (addresses.length === 0) {
    throw new Error("URL host did not resolve.");
  }
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new Error("Private or local URLs are not allowed.");
    }
  }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function isPrivateAddress(address: string): boolean {
  if (address.includes(":")) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fe80:") ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd")
    );
  }

  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

async function readLimitedText(
  res: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: "", truncated: false };

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = maxBytes - total;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
    chunks.push(chunk);
    total += chunk.byteLength;
    if (value.byteLength > remaining) {
      truncated = true;
      break;
    }
  }

  try {
    if (truncated) await reader.cancel();
  } catch {
    // best effort
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(bytes), truncated };
}

export function renderFetchedText(
  text: string,
  contentType: string | null,
  url?: URL,
): string {
  if (isHtmlContent(text, contentType)) {
    return htmlToReadableText(text, url).trim() || "(empty HTML document)";
  }
  return text;
}

function isHtmlContent(text: string, contentType: string | null): boolean {
  const normalized = contentType?.toLowerCase() ?? "";
  if (normalized.includes("text/html") || normalized.includes("application/xhtml+xml")) {
    return true;
  }
  return /^\s*<(?:!doctype\s+html|html|head|body|main|article|section|div|p|h[1-6])\b/i.test(text);
}

export function htmlToReadableText(html: string, url?: URL): string {
  let out = html
    .replace(/\r\n/g, "\n")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  const title = extractTitle(out);

  out = out
    .replace(/<\s*h1\b[^>]*>([\s\S]*?)<\s*\/h1\s*>/gi, (_m, body) => `\n# ${stripTags(body)}\n\n`)
    .replace(/<\s*h2\b[^>]*>([\s\S]*?)<\s*\/h2\s*>/gi, (_m, body) => `\n## ${stripTags(body)}\n\n`)
    .replace(/<\s*h3\b[^>]*>([\s\S]*?)<\s*\/h3\s*>/gi, (_m, body) => `\n### ${stripTags(body)}\n\n`)
    .replace(/<\s*h[4-6]\b[^>]*>([\s\S]*?)<\s*\/h[4-6]\s*>/gi, (_m, body) => `\n#### ${stripTags(body)}\n\n`)
    .replace(/<\s*a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\s*\/a\s*>/gi, (_m, href, label) => {
      const cleanLabel = collapseInlineWhitespace(decodeHtmlEntities(stripTags(label))).trim();
      const cleanHref = resolveHref(String(href), url);
      if (!cleanLabel) return cleanHref;
      if (cleanLabel === cleanHref) return cleanHref;
      return `${cleanLabel} (${cleanHref})`;
    })
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/p\s*>/gi, "\n\n")
    .replace(/<\s*\/div\s*>/gi, "\n")
    .replace(/<\s*\/section\s*>/gi, "\n\n")
    .replace(/<\s*\/article\s*>/gi, "\n\n")
    .replace(/<\s*\/main\s*>/gi, "\n\n")
    .replace(/<\s*li\b[^>]*>/gi, "\n- ")
    .replace(/<\s*\/li\s*>/gi, "")
    .replace(/<[^>]+>/g, "");

  out = decodeHtmlEntities(out);
  out = normalizeReadableWhitespace(out);

  if (title && !out.toLowerCase().startsWith(`# ${title.toLowerCase()}`)) {
    out = `# ${title}\n\n${out}`.trim();
  }
  return out;
}

function extractTitle(html: string): string | undefined {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match?.[1]) return undefined;
  const title = collapseInlineWhitespace(decodeHtmlEntities(stripTags(match[1]))).trim();
  return title || undefined;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, "");
}

function normalizeReadableWhitespace(value: string): string {
  return value
    .split("\n")
    .map((line) => collapseInlineWhitespace(line).trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+|\s+$/g, "");
}

function collapseInlineWhitespace(value: string): string {
  return value.replace(/[\t \f\v]+/g, " ");
}

function resolveHref(href: string, base?: URL): string {
  try {
    return base ? new URL(href, base).toString() : href;
  } catch {
    return href;
  }
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (match, entity) => {
    const raw = String(entity).toLowerCase();
    if (raw.startsWith("#x")) {
      const code = Number.parseInt(raw.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (raw.startsWith("#")) {
      const code = Number.parseInt(raw.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named[raw] ?? match;
  });
}

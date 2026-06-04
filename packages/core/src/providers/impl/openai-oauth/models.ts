/**
 * Live model catalog from the Codex backend.
 *
 * The Codex CLI doesn't ship a model list — it fetches it from
 * /backend-api/codex/models, which also tells us each model's valid reasoning
 * levels (low/medium/high/xhigh) and defaults. LuckyCLI does the same so the
 * model picker and the reasoning-effort choice always match what the account can
 * actually use, instead of a stale hardcoded list.
 */
import { ensureChatGptCa } from "./chatgpt-tls.js";
import { CODEX_CLIENT_VERSION, CODEX_MODELS_ENDPOINT, type OpenAiOAuthTokens } from "./tokens.js";

export interface CodexReasoningLevel {
  effort: string;
  description?: string;
}

export interface CodexModel {
  slug: string;
  displayName: string;
  description?: string;
  contextWindow?: number;
  maxContextWindow?: number;
  supportVerbosity?: boolean;
  defaultVerbosity?: string;
  defaultReasoningLevel?: string;
  supportedReasoningLevels: CodexReasoningLevel[];
}

interface RawCodexModel {
  slug?: unknown;
  display_name?: unknown;
  description?: unknown;
  context_window?: unknown;
  max_context_window?: unknown;
  support_verbosity?: unknown;
  default_verbosity?: unknown;
  default_reasoning_level?: unknown;
  supported_reasoning_levels?: unknown;
}

/** Fetch the account's available Codex models and their reasoning metadata. */
export async function fetchCodexModels(
  tokens: OpenAiOAuthTokens,
  opts: { fetchImpl?: typeof fetch; clientVersion?: string } = {},
): Promise<CodexModel[]> {
  ensureChatGptCa();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const version = opts.clientVersion ?? CODEX_CLIENT_VERSION;
  const url = `${CODEX_MODELS_ENDPOINT}?client_version=${encodeURIComponent(version)}`;

  const res = await fetchImpl(url, {
    method: "GET",
    headers: {
      accept: "*/*",
      Authorization: `Bearer ${tokens.access}`,
      "User-Agent": `codex-tui/${version} (LuckyCLI)`,
      originator: "codex-tui",
      version,
      ...(tokens.accountId ? { "chatgpt-account-id": tokens.accountId } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Codex models endpoint failed (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as { models?: unknown };
  const raw = Array.isArray(data.models) ? (data.models as RawCodexModel[]) : [];
  return raw.map(normalizeModel).filter((m): m is CodexModel => m !== null);
}

function normalizeModel(raw: RawCodexModel): CodexModel | null {
  if (typeof raw.slug !== "string" || !raw.slug) return null;
  const levels = Array.isArray(raw.supported_reasoning_levels)
    ? (raw.supported_reasoning_levels as Array<{ effort?: unknown; description?: unknown }>)
        .filter((l) => typeof l.effort === "string")
        .map((l) => ({
          effort: l.effort as string,
          ...(typeof l.description === "string" ? { description: l.description } : {}),
        }))
    : [];
  return {
    slug: raw.slug,
    displayName: typeof raw.display_name === "string" ? raw.display_name : raw.slug,
    ...(typeof raw.description === "string" ? { description: raw.description } : {}),
    ...(typeof raw.context_window === "number" ? { contextWindow: raw.context_window } : {}),
    ...(typeof raw.max_context_window === "number"
      ? { maxContextWindow: raw.max_context_window }
      : {}),
    ...(typeof raw.support_verbosity === "boolean"
      ? { supportVerbosity: raw.support_verbosity }
      : {}),
    ...(typeof raw.default_verbosity === "string"
      ? { defaultVerbosity: raw.default_verbosity }
      : {}),
    ...(typeof raw.default_reasoning_level === "string"
      ? { defaultReasoningLevel: raw.default_reasoning_level }
      : {}),
    supportedReasoningLevels: levels,
  };
}

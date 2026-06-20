/**
 * Generic model discovery via the OpenAI-standard `GET /v1/models` endpoint,
 * shared by every OpenAI-compatible server we support (llama.cpp, vLLM, and
 * arbitrary custom servers). Lets the setup dialog propose the model names the
 * server actually serves instead of asking the user to type them blind.
 *
 * vLLM additionally reports `max_model_len` per model; we surface it so the same
 * call can prefill the context window too.
 */

import { OPENROUTER_BASE_URL } from "./openrouter/OpenRouterProvider.js";
import {
  OPENCODE_ZEN_BASE_URL,
  OPENCODE_ZEN_PUBLIC_KEY,
} from "./opencode-zen/OpencodeZenProvider.js";

export interface OpenAiCompatibleModel {
  id: string;
  /** Context window (tokens), when the server reports it (vLLM's max_model_len). */
  contextWindow?: number;
}

interface ModelsResponse {
  data?: Array<{ id?: string; max_model_len?: number }>;
}

interface OpenRouterModelsResponse {
  data?: Array<{
    id?: string;
    context_length?: number;
    top_provider?: { context_length?: number };
  }>;
}

function authHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}

/**
 * List the models a `/v1/models` endpoint advertises. `baseUrl` is the server
 * origin WITHOUT the `/v1` suffix for llama.cpp/vLLM; for a custom server it may
 * already include a path, so we append `/v1/models` only when no path is present.
 * Returns [] when unreachable.
 */
export async function fetchOpenAiCompatibleModels(
  baseUrl: string,
  apiKey?: string,
  signal?: AbortSignal,
): Promise<OpenAiCompatibleModel[]> {
  const url = modelsUrl(baseUrl);
  try {
    const res = await fetch(url, { headers: authHeaders(apiKey), signal });
    if (!res.ok) return [];
    const data = (await res.json()) as ModelsResponse;
    const seen = new Set<string>();
    const out: OpenAiCompatibleModel[] = [];
    for (const m of data.data ?? []) {
      if (!m.id || seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(
        typeof m.max_model_len === "number" && m.max_model_len > 0
          ? { id: m.id, contextWindow: m.max_model_len }
          : { id: m.id },
      );
    }
    return out;
  } catch {
    return [];
  }
}

/** Build the `/v1/models` URL, respecting a base URL that already has a path. */
function modelsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  let hasPath = false;
  try {
    hasPath = new URL(trimmed).pathname.replace(/\/+$/, "") !== "";
  } catch {
    hasPath = /\/[^/]+$/.test(trimmed.replace(/^https?:\/\/[^/]+/, ""));
  }
  return hasPath ? `${trimmed}/models` : `${trimmed}/v1/models`;
}

/**
 * List the models the OpenRouter gateway advertises. The base URL already
 * includes `/api/v1`, so `/models` is appended directly. Returns [] when
 * unreachable, so the caller can fall back to the bootstrap catalog list.
 */
export async function fetchOpenRouterModels(
  apiKey: string,
  signal?: AbortSignal,
): Promise<OpenAiCompatibleModel[]> {
  try {
    const res = await fetch(`${OPENROUTER_BASE_URL}/models`, {
      headers: authHeaders(apiKey),
      signal,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as OpenRouterModelsResponse;
    const seen = new Set<string>();
    const out: OpenAiCompatibleModel[] = [];
    for (const m of data.data ?? []) {
      if (!m.id || seen.has(m.id)) continue;
      seen.add(m.id);
      // top_provider.context_length is the effective limit for the routed
      // backend; fall back to the model-level context_length.
      const ctx = m.top_provider?.context_length ?? m.context_length;
      out.push(
        typeof ctx === "number" && ctx > 0
          ? { id: m.id, contextWindow: ctx }
          : { id: m.id },
      );
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * List the models opencode Zen advertises. Falls back to the shared public key
 * when none is supplied, matching the provider. Returns [] when unreachable.
 */
export async function fetchOpencodeZenModels(
  apiKey?: string,
  signal?: AbortSignal,
): Promise<OpenAiCompatibleModel[]> {
  return fetchOpenAiCompatibleModels(
    OPENCODE_ZEN_BASE_URL,
    apiKey || OPENCODE_ZEN_PUBLIC_KEY,
    signal,
  );
}

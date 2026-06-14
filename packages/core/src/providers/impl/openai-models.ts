/**
 * Generic model discovery via the OpenAI-standard `GET /v1/models` endpoint,
 * shared by every OpenAI-compatible server we support (llama.cpp, vLLM, and
 * arbitrary custom servers). Lets the setup dialog propose the model names the
 * server actually serves instead of asking the user to type them blind.
 *
 * vLLM additionally reports `max_model_len` per model; we surface it so the same
 * call can prefill the context window too.
 */

export interface OpenAiCompatibleModel {
  id: string;
  /** Context window (tokens), when the server reports it (vLLM's max_model_len). */
  contextWindow?: number;
}

interface ModelsResponse {
  data?: Array<{ id?: string; max_model_len?: number }>;
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

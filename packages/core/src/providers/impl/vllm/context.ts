/**
 * Context-window discovery for a running vLLM server.
 *
 * vLLM extends the OpenAI `GET /v1/models` model card with `max_model_len`
 * (the model's maximum sequence length). We read it per model. (Verified
 * against vLLM's ModelCard output.) Returns an empty map when unreachable.
 */

interface ModelsResponse {
  data?: Array<{ id?: string; max_model_len?: number }>;
}

function authHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}

/** Map of model id → context window (tokens) for every model the server lists. */
export async function fetchVllmContextWindows(
  baseUrl: string,
  apiKey?: string,
  signal?: AbortSignal,
): Promise<Record<string, number>> {
  const base = baseUrl.replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/v1/models`, {
      headers: authHeaders(apiKey),
      signal,
    });
    if (!res.ok) return {};
    const data = (await res.json()) as ModelsResponse;
    const out: Record<string, number> = {};
    for (const m of data.data ?? []) {
      if (m.id && typeof m.max_model_len === "number" && m.max_model_len > 0) {
        out[m.id] = m.max_model_len;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** The largest context window across the server's models, if any. */
export async function fetchVllmContextWindow(
  baseUrl: string,
  apiKey?: string,
  signal?: AbortSignal,
): Promise<number | undefined> {
  const windows = Object.values(await fetchVllmContextWindows(baseUrl, apiKey, signal));
  return windows.length ? Math.max(...windows) : undefined;
}

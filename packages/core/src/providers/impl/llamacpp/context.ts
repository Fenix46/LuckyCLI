/**
 * Context-window discovery for a running llama.cpp `llama-server`.
 *
 * `GET /props` returns the server's effective settings, including the loaded
 * context size at `default_generation_settings.n_ctx`. (Verified against the
 * llama.cpp server README.) Returns undefined when unreachable, so callers fall
 * back to a manual override.
 */

interface PropsResponse {
  default_generation_settings?: { n_ctx?: number };
  // Older builds surfaced n_ctx at the top level.
  n_ctx?: number;
}

export async function fetchLlamaCppContextWindow(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<number | undefined> {
  const base = baseUrl.replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/props`, { signal });
    if (!res.ok) return undefined;
    const data = (await res.json()) as PropsResponse;
    const n = data.default_generation_settings?.n_ctx ?? data.n_ctx;
    return typeof n === "number" && n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Live model discovery for a running Ollama daemon.
 *
 * Ollama exposes its own (non-OpenAI) management endpoints alongside the
 * OpenAI-compatible `/v1` surface:
 *   - `GET  /api/tags`  → the models currently installed
 *   - `POST /api/show`  → per-model metadata, including `capabilities`
 *                         (e.g. "completion", "vision", "tools") and the
 *                         architecture's context length.
 *
 * We use these to replace the hardcoded catalog list with what the user
 * actually has, and to learn whether a model supports vision.
 */

export interface OllamaModel {
  id: string;
  contextWindow?: number;
  /** True when the model reports the "vision" capability. */
  vision: boolean;
}

interface TagsResponse {
  models?: Array<{ name?: string; model?: string }>;
}

interface ShowResponse {
  capabilities?: string[];
  model_info?: Record<string, unknown>;
}

function normalizeBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/** Pull the context length out of `/api/show`'s `model_info` bag. */
function readContextWindow(info: Record<string, unknown> | undefined): number | undefined {
  if (!info) return undefined;
  // Keys are namespaced by architecture, e.g. "llama.context_length".
  for (const [key, value] of Object.entries(info)) {
    if (key.endsWith(".context_length") && typeof value === "number") {
      return value;
    }
  }
  return undefined;
}

async function fetchShow(
  base: string,
  model: string,
  signal?: AbortSignal,
): Promise<{ contextWindow?: number; vision: boolean }> {
  try {
    const res = await fetch(`${base}/api/show`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
      signal,
    });
    if (!res.ok) return { vision: false };
    const data = (await res.json()) as ShowResponse;
    const vision = (data.capabilities ?? []).includes("vision");
    return { contextWindow: readContextWindow(data.model_info), vision };
  } catch {
    return { vision: false };
  }
}

/**
 * List the installed Ollama models with their capabilities. Returns an empty
 * array if the daemon is unreachable — callers fall back to the static catalog.
 */
export async function fetchOllamaModels(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<OllamaModel[]> {
  const base = normalizeBase(baseUrl);
  let tags: TagsResponse;
  try {
    const res = await fetch(`${base}/api/tags`, { signal });
    if (!res.ok) return [];
    tags = (await res.json()) as TagsResponse;
  } catch {
    return [];
  }

  const names = (tags.models ?? [])
    .map((m) => m.model ?? m.name)
    .filter((n): n is string => typeof n === "string" && n.length > 0);

  const seen = new Set<string>();
  const unique = names.filter((n) => (seen.has(n) ? false : (seen.add(n), true)));

  return Promise.all(
    unique.map(async (id) => {
      const { contextWindow, vision } = await fetchShow(base, id, signal);
      return { id, contextWindow, vision } satisfies OllamaModel;
    }),
  );
}

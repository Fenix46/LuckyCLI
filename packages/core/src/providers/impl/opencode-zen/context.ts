/**
 * Context-window discovery for opencode Zen.
 *
 * Zen's own `/models` endpoint returns only ids (no context window), so the
 * limits come from models.dev's public catalog, where the `opencode` provider
 * lists each model with `limit.context`. We fetch it once and cache the result
 * in memory for the process lifetime; failures degrade to an empty map so the
 * caller simply falls back to no context window.
 */

const MODELS_DEV_URL = "https://models.dev/api.json";

interface ModelsDevModel {
  limit?: { context?: number };
}
interface ModelsDevProvider {
  models?: Record<string, ModelsDevModel>;
}
type ModelsDevApi = Record<string, ModelsDevProvider>;

let cache: Promise<Record<string, number>> | undefined;

/**
 * Map of zen model id → context window (tokens), sourced from models.dev. Cached
 * for the process; returns {} when unreachable.
 */
export function fetchOpencodeZenContextWindows(
  signal?: AbortSignal,
): Promise<Record<string, number>> {
  if (!cache) cache = load(signal);
  return cache;
}

/** Resolve the context window for a single zen model id, or undefined. */
export async function fetchOpencodeZenContextWindow(
  modelId: string,
  signal?: AbortSignal,
): Promise<number | undefined> {
  const windows = await fetchOpencodeZenContextWindows(signal);
  return windows[modelId];
}

async function load(signal?: AbortSignal): Promise<Record<string, number>> {
  try {
    const res = await fetch(MODELS_DEV_URL, { signal });
    if (!res.ok) return {};
    const api = (await res.json()) as ModelsDevApi;
    const models = api.opencode?.models ?? {};
    const out: Record<string, number> = {};
    for (const [id, model] of Object.entries(models)) {
      const ctx = model.limit?.context;
      if (typeof ctx === "number" && ctx > 0) out[id] = ctx;
    }
    return out;
  } catch {
    return {};
  }
}

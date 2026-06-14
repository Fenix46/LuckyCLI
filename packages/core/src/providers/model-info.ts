/**
 * Helpers for stamping a known context window onto a provider's catalog info.
 *
 * The static catalog leaves `contextWindow` undefined for local providers — we
 * can't know it ahead of time. Once we learn it (a manual override entered at
 * setup, or auto-discovered from the server), we clone the shared ProviderInfo
 * and apply the limit to the model(s) so `currentModelInfo()` in the agent can
 * compute usable tokens — which drives the context indicator and auto-compaction.
 */

import type { ProviderInfo } from "./types.js";

/**
 * Return a copy of `info` with `contextWindow` applied to its default model
 * (and any other catalog models that lack one). A `undefined` window is a
 * no-op, returning the original reference.
 */
export function withContextWindow(
  info: ProviderInfo,
  contextWindow: number | undefined,
): ProviderInfo {
  if (!contextWindow || contextWindow <= 0) return info;
  const models = { ...(info.models ?? {}) };
  for (const id of info.availableModels) {
    const existing = models[id] ?? { id };
    models[id] = { ...existing, contextWindow };
  }
  return { ...info, models };
}

/**
 * Return a copy of `info` with per-model context windows applied from a
 * discovery map (model id → tokens). Models absent from the map keep their
 * existing entry. Useful when a server reports a window per model (Ollama, vLLM).
 */
export function withDiscoveredContextWindows(
  info: ProviderInfo,
  byModel: Record<string, number>,
): ProviderInfo {
  const entries = Object.entries(byModel).filter(([, w]) => w > 0);
  if (entries.length === 0) return info;
  const models = { ...(info.models ?? {}) };
  for (const [id, contextWindow] of entries) {
    const existing = models[id] ?? { id };
    models[id] = { ...existing, contextWindow };
  }
  return { ...info, models };
}

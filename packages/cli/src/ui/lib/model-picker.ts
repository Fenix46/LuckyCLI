import { PROVIDER_CATALOG, type ProviderId } from "@luckycli/core";
import { THEMES, type Theme } from "../themes.js";

export function getModelPickerState(
  input: string,
  provider: ProviderId,
  activeModel: string,
): { open: boolean; query: string; items: string[] } {
  if (input !== "/model" && !input.startsWith("/model ")) {
    return { open: false, query: "", items: [] };
  }

  const query = input.slice("/model".length).trim().toLowerCase();
  const models = getAvailableModels(provider, activeModel);
  const items = query
    ? models.filter((model) => model.toLowerCase().includes(query))
    : models;
  return { open: true, query, items };
}

export function getThemePickerState(
  input: string,
  activeThemeId: string,
): { open: boolean; query: string; items: Theme[] } {
  if (input !== "/theme" && !input.startsWith("/theme ")) {
    return { open: false, query: "", items: [] };
  }

  const query = input.slice("/theme".length).trim().toLowerCase();
  const themes = [...THEMES].sort((a, b) => {
    if (a.id === activeThemeId) return -1;
    if (b.id === activeThemeId) return 1;
    return 0;
  });
  const items = query
    ? themes.filter(
        (theme) =>
          theme.id.toLowerCase().includes(query) ||
          theme.name.toLowerCase().includes(query),
      )
    : themes;
  return { open: true, query, items };
}

export function getAvailableModels(provider: ProviderId, activeModel?: string): string[] {
  const models = [...PROVIDER_CATALOG[provider].availableModels];
  if (activeModel && !models.includes(activeModel)) {
    models.unshift(activeModel);
  }
  return models;
}

export function validateModel(
  provider: ProviderId,
  model: string,
): { ok: true } | { ok: false; message: string } {
  if (!model) return { ok: false, message: "model id cannot be empty" };
  const knownModels = getAvailableModels(provider);
  if (knownModels.includes(model)) return { ok: true };

  if (provider === "ollama") {
    return { ok: true };
  }

  return {
    ok: false,
    message: `unknown ${provider} model: ${model}. Use /model to pick one of: ${knownModels.join(", ")}`,
  };
}

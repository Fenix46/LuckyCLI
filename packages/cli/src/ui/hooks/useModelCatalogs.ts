/**
 * Live model catalogs for the /model picker, extracted from App.tsx (the
 * deferred follow-up in APP_REFACTOR_PLAN.md). Each provider whose catalog is
 * fetched at runtime (Codex/openai-oauth, Antigravity, Ollama, opencode Zen,
 * OpenRouter) gets a session-memoized loader that fires when the picker opens
 * for that provider and re-fetches on `/model --refresh`. Failures degrade to
 * an empty list (static catalog / lenient validation take over); Codex and
 * Antigravity surface an error item because their pickers are useless without
 * the live list.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CodexModelCache,
  fetchCodexModels,
  fetchOllamaModels,
  fetchOpencodeZenModels,
  fetchOpenRouterModels,
  getProvider,
  loadStoredConfig,
  type CodexModel,
  type ProviderId,
} from "@luckycli/core";
import type { Item } from "../lib/items.js";

/** Is the picker input asking for a catalog re-fetch (`/model --refresh`)? */
export function isModelRefreshRequest(input: string): boolean {
  return input.slice("/model".length).trim() === "--refresh";
}

/** Does this input open the /model picker? Mirrors getModelPickerState. */
export function isModelPickerInput(input: string): boolean {
  return input === "/model" || input.startsWith("/model ");
}

/** The live model list for the active provider, if that provider has one. */
export function liveModelsFor(
  provider: ProviderId,
  catalogs: {
    codex: CodexModel[];
    antigravity: string[];
    ollama: string[];
    zen: string[];
    openRouter: string[];
  },
): string[] | undefined {
  switch (provider) {
    case "openai-oauth":
      return catalogs.codex.map((m) => m.slug);
    case "antigravity":
      return catalogs.antigravity;
    case "ollama":
      return catalogs.ollama;
    case "opencode-zen":
      return catalogs.zen;
    case "openrouter":
      return catalogs.openRouter;
    default:
      return undefined;
  }
}

export interface ModelCatalogs {
  /** Live slugs for the active provider; undefined = static catalog. */
  liveModels: string[] | undefined;
  /** Full Codex models (slug + effort metadata), for the effort picker. */
  codexModels: CodexModel[];
}

export function useModelCatalogs(options: {
  provider: ProviderId;
  /** Current prompt text; drives picker-open detection and --refresh. */
  input: string;
  /** Append a transcript item (error surfacing). */
  emit: (item: Item) => void;
}): ModelCatalogs {
  const { provider, input, emit } = options;
  const pickerOpen = isModelPickerInput(input);

  const codexCacheRef = useRef<CodexModelCache | null>(null);
  const [codexModels, setCodexModels] = useState<CodexModel[]>([]);
  const antigravityModelsRef = useRef<Promise<string[]> | null>(null);
  const [antigravityModels, setAntigravityModels] = useState<string[]>([]);
  const ollamaModelsRef = useRef<Promise<string[]> | null>(null);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const zenModelsRef = useRef<Promise<string[]> | null>(null);
  const [zenModels, setZenModels] = useState<string[]>([]);
  const openRouterModelsRef = useRef<Promise<string[]> | null>(null);
  const [openRouterModels, setOpenRouterModels] = useState<string[]>([]);

  // Fetch the live Codex catalog (memoized for the session). Returns [] on
  // failure after surfacing an error item; the active model still works.
  const loadCodexModels = useCallback(
    async (refresh = false): Promise<CodexModel[]> => {
      const creds = loadStoredConfig().credentials?.["openai-oauth"];
      if (!creds || creds.type !== "openai-oauth") return [];
      const tokens = creds;
      if (!codexCacheRef.current) {
        codexCacheRef.current = new CodexModelCache(() =>
          fetchCodexModels({
            access: tokens.access,
            refresh: tokens.refresh,
            expires: tokens.expires,
            ...(tokens.accountId ? { accountId: tokens.accountId } : {}),
          }),
        );
      }
      try {
        const models = await codexCacheRef.current.get({ refresh });
        setCodexModels(models);
        return models;
      } catch (error) {
        emit({
          kind: "error",
          text: `Could not fetch ChatGPT models: ${error instanceof Error ? error.message : error}`,
        });
        return [];
      }
    },
    [emit],
  );

  const loadAntigravityModels = useCallback(
    async (refresh = false): Promise<string[]> => {
      const creds = loadStoredConfig().credentials?.antigravity;
      if (!creds || creds.type !== "antigravity") return [];
      if (!antigravityModelsRef.current || refresh) {
        antigravityModelsRef.current = (async () => {
          const antigravityProvider = getProvider("antigravity", creds);
          await antigravityProvider.getStatus?.();
          const models = antigravityProvider.info.availableModels ?? [];
          setAntigravityModels(models);
          return models;
        })().catch((error) => {
          antigravityModelsRef.current = null;
          emit({
            kind: "error",
            text: `Could not fetch Antigravity models: ${error instanceof Error ? error.message : error}`,
          });
          return [];
        });
      }
      return antigravityModelsRef.current;
    },
    [emit],
  );

  // Discover installed Ollama models when the picker opens. Returns [] if the
  // daemon is unreachable; the active model still works (validation is lenient).
  const loadOllamaModels = useCallback(async (refresh = false): Promise<string[]> => {
    const creds = loadStoredConfig().credentials?.ollama;
    if (!creds || creds.type !== "ollama") return [];
    if (!ollamaModelsRef.current || refresh) {
      ollamaModelsRef.current = fetchOllamaModels(creds.baseUrl)
        .then((models) => {
          const ids = models.map((m) => m.id);
          setOllamaModels(ids);
          return ids;
        })
        .catch(() => {
          ollamaModelsRef.current = null;
          return [];
        });
    }
    return ollamaModelsRef.current;
  }, []);

  // Fetch the live opencode Zen catalog when the picker opens. Falls back to the
  // public key in core when no key is stored. Returns [] if unreachable.
  const loadZenModels = useCallback(async (refresh = false): Promise<string[]> => {
    const creds = loadStoredConfig().credentials?.["opencode-zen"];
    if (!creds || creds.type !== "opencode-zen") return [];
    if (!zenModelsRef.current || refresh) {
      zenModelsRef.current = fetchOpencodeZenModels(creds.apiKey)
        .then((models) => {
          const ids = models.map((m) => m.id);
          setZenModels(ids);
          return ids;
        })
        .catch(() => {
          zenModelsRef.current = null;
          return [];
        });
    }
    return zenModelsRef.current;
  }, []);

  // Fetch the live OpenRouter catalog when the picker opens. Returns [] if
  // unreachable; the active model still works (validation is lenient).
  const loadOpenRouterModels = useCallback(async (refresh = false): Promise<string[]> => {
    const creds = loadStoredConfig().credentials?.openrouter;
    if (!creds || creds.type !== "openrouter") return [];
    if (!openRouterModelsRef.current || refresh) {
      openRouterModelsRef.current = fetchOpenRouterModels(creds.apiKey)
        .then((models) => {
          const ids = models.map((m) => m.id);
          setOpenRouterModels(ids);
          return ids;
        })
        .catch(() => {
          openRouterModelsRef.current = null;
          return [];
        });
    }
    return openRouterModelsRef.current;
  }, []);

  // One effect per runtime-catalog provider: fetch when the picker opens for
  // that provider, re-fetch on `/model --refresh`.
  const loaderFor: Partial<Record<ProviderId, (refresh?: boolean) => Promise<unknown>>> = {
    "openai-oauth": loadCodexModels,
    antigravity: loadAntigravityModels,
    ollama: loadOllamaModels,
    "opencode-zen": loadZenModels,
    openrouter: loadOpenRouterModels,
  };
  const loader = loaderFor[provider];
  useEffect(() => {
    if (!pickerOpen || !loader) return;
    void loader(isModelRefreshRequest(input));
  }, [pickerOpen, input, loader]);

  return {
    liveModels: liveModelsFor(provider, {
      codex: codexModels,
      antigravity: antigravityModels,
      ollama: ollamaModels,
      zen: zenModels,
      openRouter: openRouterModels,
    }),
    codexModels,
  };
}

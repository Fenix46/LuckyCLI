import type { ModelInfo } from "../../types.js";

export interface AntigravityAvailableModel {
  displayName?: string;
  maxTokens?: number;
  maxOutputTokens?: number;
  supportsThinking?: boolean;
  thinkingBudget?: number;
  quotaInfo?: {
    remainingFraction?: number;
    resetTime?: string;
  };
}

/** The models Antigravity offers, in its own picker order. */
export const ANTIGRAVITY_VISIBLE_MODEL_IDS = [
  "gemini-3.8-flash-high",
  "gemini-3.8-flash-medium",
  "gemini-3.8-flash-low",
  "gemini-3.7-flash-high",
  "gemini-3.7-flash-medium",
  "gemini-3.7-flash-low",
  "gemini-3.6-flash-high",
  "gemini-3.6-flash-medium",
  "gemini-3.6-flash-low",
  "gemini-pro-agent",
  "gemini-3.1-pro-low",
  "claude-sonnet-4-6",
  "claude-opus-4-6-thinking",
  "gpt-oss-120b-medium",
] as const;

const ANTIGRAVITY_MODEL_LABELS: Record<string, string> = {
  "gemini-3.8-flash-high": "Gemini 3.8 Flash (High)",
  "gemini-3.8-flash-medium": "Gemini 3.8 Flash (Medium)",
  "gemini-3.8-flash-low": "Gemini 3.8 Flash (Low)",
  "gemini-3.7-flash-high": "Gemini 3.7 Flash (High)",
  "gemini-3.7-flash-medium": "Gemini 3.7 Flash (Medium)",
  "gemini-3.7-flash-low": "Gemini 3.7 Flash (Low)",
  "gemini-3.6-flash-high": "Gemini 3.6 Flash (High)",
  "gemini-3.6-flash-medium": "Gemini 3.6 Flash (Medium)",
  "gemini-3.6-flash-low": "Gemini 3.6 Flash (Low)",
  "gemini-pro-agent": "Gemini 3.1 Pro (High)",
  "gemini-3.1-pro-low": "Gemini 3.1 Pro (Low)",
  "claude-sonnet-4-6": "Claude Sonnet 4.6 (Thinking)",
  "claude-opus-4-6-thinking": "Claude Opus 4.6 (Thinking)",
  "gpt-oss-120b-medium": "GPT-OSS 120B (Medium)",
  // Retired from the picker; kept so saved configs still read well.
  "gemini-3.5-flash-low": "Gemini 3.5 Flash (Medium)",
  "gemini-3-flash-agent": "Gemini 3.5 Flash (High)",
  "gemini-3.5-flash-extra-low": "Gemini 3.5 Flash (Low)",
};

/**
 * Display names the backend reported for models outside the static label
 * table, remembered when the live catalog is read so pickers can label them.
 */
const liveDisplayNames = new Map<string, string>();

/**
 * Newer Gemini models than any in the static list, recognized by the backend
 * display name ("Gemini 3.9 Flash (High)", "Gemini 4 Pro"). Antigravity ships
 * these without LuckyCLI knowing their ids in advance; older or internal
 * entries (tab completion, lite models) stay hidden.
 */
const NEW_GEMINI_DISPLAY_NAME = /^Gemini (\d+(?:\.\d+)?) (Flash|Pro)\b/;
const NEWEST_KNOWN_GEMINI_VERSION = 3.8;

function newGeminiVersion(id: string, model: AntigravityAvailableModel | undefined): number | undefined {
  if (id in ANTIGRAVITY_MODEL_LABELS || id.startsWith("tab_")) return undefined;
  const match = model?.displayName?.match(NEW_GEMINI_DISPLAY_NAME);
  const version = match ? Number(match[1]) : undefined;
  return version !== undefined && version > NEWEST_KNOWN_GEMINI_VERSION ? version : undefined;
}

/**
 * The models to offer, in picker order: Gemini models newer than the static
 * list first (newest version first), then the known models the account still
 * has. With no live catalog, the static list.
 */
export function antigravityVisibleModelIds(
  models: Record<string, AntigravityAvailableModel> | undefined,
): string[] {
  if (!models) return [...ANTIGRAVITY_VISIBLE_MODEL_IDS];
  const newer = Object.entries(models)
    .map(([id, model]) => ({ id, model, version: newGeminiVersion(id, model) }))
    .filter((entry): entry is { id: string; model: AntigravityAvailableModel; version: number } => entry.version !== undefined)
    .sort((a, b) => b.version - a.version);
  for (const { id, model } of newer) {
    if (model.displayName) liveDisplayNames.set(id, model.displayName);
  }
  return [...newer.map((entry) => entry.id), ...ANTIGRAVITY_VISIBLE_MODEL_IDS.filter((id) => id in models)];
}

export function antigravityModelLabel(id: string, displayName?: string): string {
  return ANTIGRAVITY_MODEL_LABELS[id] ?? displayName ?? liveDisplayNames.get(id) ?? id;
}

export type AntigravityEffort = "low" | "medium" | "high";
const ANTIGRAVITY_EFFORTS: readonly AntigravityEffort[] = ["low", "medium", "high"];

/**
 * One row of the model picker: a model and its effort variants. Antigravity
 * serves each effort level of a model as its own id ("Gemini 3.5 Flash (Low)",
 * "(Medium)", "(High)"); the picker shows the model once and offers the
 * levels as a reasoning-effort choice, like Antigravity's own effort slider.
 */
export interface AntigravityModelFamily {
  /** "Gemini 3.5 Flash" — or the full label when there is a single variant. */
  label: string;
  /** Model id per effort level, for families with effort variants. */
  variants: Partial<Record<AntigravityEffort, string>>;
  /** Every id in the family, in picker order. */
  ids: string[];
}

function splitEffort(label: string): { base: string; effort?: AntigravityEffort } {
  const match = label.match(/^(.*) \((Low|Medium|High)\)$/);
  if (!match) return { base: label };
  return { base: match[1]!, effort: match[2]!.toLowerCase() as AntigravityEffort };
}

/** Group model ids into picker rows, keeping first-appearance order. */
export function antigravityModelFamilies(ids: readonly string[]): AntigravityModelFamily[] {
  const families = new Map<string, AntigravityModelFamily>();
  for (const id of ids) {
    const label = antigravityModelLabel(id);
    const { base, effort } = splitEffort(label);
    const family = families.get(base) ?? { label: base, variants: {}, ids: [] };
    family.ids.push(id);
    if (effort && !family.variants[effort]) family.variants[effort] = id;
    families.set(base, family);
  }
  return [...families.values()].map((family) =>
    family.ids.length === 1 ? { ...family, label: antigravityModelLabel(family.ids[0]!) } : family,
  );
}

/** The family a model id belongs to, among the given ids. */
export function antigravityModelFamily(
  ids: readonly string[],
  id: string,
): AntigravityModelFamily | undefined {
  return antigravityModelFamilies(ids.includes(id) ? ids : [id, ...ids]).find((family) =>
    family.ids.includes(id),
  );
}

/** Effort levels a family offers, low to high (empty for a single model). */
export function antigravityEffortLevels(family: AntigravityModelFamily): AntigravityEffort[] {
  if (family.ids.length < 2) return [];
  return ANTIGRAVITY_EFFORTS.filter((effort) => family.variants[effort] !== undefined);
}

/** The id a picker row stands for: the medium variant, else the first. */
export function antigravityFamilyDefaultId(family: AntigravityModelFamily): string {
  return family.variants.medium ?? family.ids[0]!;
}

export function antigravityModelInfo(
  id: string,
  model: AntigravityAvailableModel | undefined,
): ModelInfo {
  return {
    id,
    ...(typeof model?.maxTokens === "number" ? { contextWindow: model.maxTokens } : {}),
    ...(typeof model?.maxOutputTokens === "number"
      ? { maxOutputTokens: model.maxOutputTokens }
      : {}),
    source: "provider",
  };
}

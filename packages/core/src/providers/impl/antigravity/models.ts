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

export const ANTIGRAVITY_VISIBLE_MODEL_IDS = [
  "gemini-3.5-flash-low",
  "gemini-3-flash-agent",
  "gemini-3.5-flash-extra-low",
  "gemini-3.1-pro-low",
  "gemini-pro-agent",
  "claude-sonnet-4-6",
  "claude-opus-4-6-thinking",
  "gpt-oss-120b-medium",
] as const;

const ANTIGRAVITY_MODEL_LABELS: Record<string, string> = {
  "gemini-3.5-flash-low": "Gemini 3.5 Flash (Medium)",
  "gemini-3-flash-agent": "Gemini 3.5 Flash (High)",
  "gemini-3.5-flash-extra-low": "Gemini 3.5 Flash (Low)",
  "gemini-3.1-pro-low": "Gemini 3.1 Pro (Low)",
  "gemini-pro-agent": "Gemini 3.1 Pro (High)",
  "claude-sonnet-4-6": "Claude Sonnet 4.6 (Thinking)",
  "claude-opus-4-6-thinking": "Claude Opus 4.6 (Thinking)",
  "gpt-oss-120b-medium": "GPT-OSS 120B (Medium)",
};

export function antigravityVisibleModelIds(
  models: Record<string, AntigravityAvailableModel> | undefined,
): string[] {
  if (!models) return [...ANTIGRAVITY_VISIBLE_MODEL_IDS];
  return ANTIGRAVITY_VISIBLE_MODEL_IDS.filter((id) => id in models);
}

export function antigravityModelLabel(id: string, displayName?: string): string {
  return ANTIGRAVITY_MODEL_LABELS[id] ?? displayName ?? id;
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

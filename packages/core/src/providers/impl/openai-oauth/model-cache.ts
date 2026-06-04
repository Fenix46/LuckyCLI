/**
 * Session-scoped cache of the live Codex model catalog.
 *
 * The model list is fetched live (no network = no Codex anyway), but we don't
 * want to hit the backend every time the model picker opens. The first get()
 * fetches and memoizes for the rest of the session; pass { refresh: true } (the
 * `/model --refresh` escape hatch) to re-fetch. Purely in-memory — no disk cache.
 */
import type { CodexModel } from "./models.js";

export class CodexModelCache {
  private pending: Promise<CodexModel[]> | undefined;

  constructor(private readonly load: () => Promise<CodexModel[]>) {}

  get(opts: { refresh?: boolean } = {}): Promise<CodexModel[]> {
    if (opts.refresh || !this.pending) {
      this.pending = this.load().catch((err) => {
        // Don't memoize a failure — let the next call retry.
        this.pending = undefined;
        throw err;
      });
    }
    return this.pending;
  }
}

/** Reasoning effort levels a model supports, in backend order. */
export function effortLevelsFor(models: CodexModel[], slug: string): string[] {
  return models.find((m) => m.slug === slug)?.supportedReasoningLevels.map((l) => l.effort) ?? [];
}

/** The model's server-side default reasoning level, if it advertises one. */
export function defaultEffortFor(models: CodexModel[], slug: string): string | undefined {
  return models.find((m) => m.slug === slug)?.defaultReasoningLevel;
}

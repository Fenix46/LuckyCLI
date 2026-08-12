/**
 * LuckyCLI's `_meta` extensions to the ACP wire format.
 *
 * ACP has no standard shape for token usage or context-window pressure, but
 * both are things an editor front-end wants to show. The protocol reserves
 * `_meta` on every request, response and notification for exactly this, and
 * clients ignore keys they don't know — so these are additive: an editor that
 * has never heard of LuckyCLI behaves identically.
 *
 * The keys are namespaced under `dev.luckycli/` and treated as a contract for
 * custom clients (see docs/editors.md); the same numbers are available as text
 * through the `/context` and `/status` slash commands, which is the portable
 * path for editors that surface no `_meta` at all.
 */
import type { ContextStatus } from "@luckycli/core";

/** Per-turn token usage, on the PromptResponse. */
export const USAGE_META_KEY = "dev.luckycli/usage";

/** Context-window pressure, on session notifications and the PromptResponse. */
export const CONTEXT_META_KEY = "dev.luckycli/context";

/**
 * The stable subset of the engine's ContextStatus we publish. Deliberately
 * narrower than the internal type: these are the fields a front-end can render
 * as a usage indicator, and pinning them keeps the wire contract from drifting
 * every time the engine's bookkeeping grows a field.
 */
export interface ContextMeta {
  model: string;
  /** Total window, when the provider tells us. */
  contextWindow?: number;
  /** Tokens currently occupied by the conversation. */
  usedTokens?: number;
  /** Tokens usable before compaction kicks in. */
  usableTokens?: number;
  /** usedTokens as a percentage of usableTokens, rounded. */
  usedPercentage?: number;
  /** Cumulative cache reads/writes for the session, when reported. */
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** How the numbers were obtained — "unavailable" means they are estimates. */
  tokenCounter: ContextStatus["tokenCounter"];
}

/**
 * Whether a reading says anything about consumption. A provider that cannot
 * count tokens still produces a ContextStatus (model + "unavailable"), and
 * publishing that as usage metadata would be noise, not information.
 */
export function hasTokenCounts(status: ContextStatus): boolean {
  return status.usedTokens !== undefined || status.contextWindow !== undefined;
}

/** Project a ContextStatus onto the published subset, dropping absent fields. */
export function contextMeta(status: ContextStatus): ContextMeta {
  return {
    model: status.model,
    ...(status.contextWindow !== undefined ? { contextWindow: status.contextWindow } : {}),
    ...(status.usedTokens !== undefined ? { usedTokens: status.usedTokens } : {}),
    ...(status.usableTokens !== undefined ? { usableTokens: status.usableTokens } : {}),
    ...(status.usedPercentage !== undefined
      ? { usedPercentage: Math.round(status.usedPercentage) }
      : {}),
    ...(status.totalCacheReadTokens !== undefined
      ? { cacheReadTokens: status.totalCacheReadTokens }
      : {}),
    ...(status.totalCacheWriteTokens !== undefined
      ? { cacheWriteTokens: status.totalCacheWriteTokens }
      : {}),
    tokenCounter: status.tokenCounter,
  };
}

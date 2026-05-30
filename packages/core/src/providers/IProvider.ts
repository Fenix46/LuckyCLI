/**
 * The single interface every AI provider implements.
 * Engine code depends ONLY on this — never on a provider SDK directly.
 */

import type {
  GenerationConfig,
  GenerationResponse,
  Message,
  ProviderInfo,
  StreamChunk,
  TokenUsage,
} from "./types.js";

export interface IProvider {
  readonly info: ProviderInfo;

  /** Single-shot generation; resolves once the full response is ready. */
  generate(
    messages: Message[],
    config: GenerationConfig,
  ): Promise<GenerationResponse>;

  /**
   * Streaming generation. Yields chunks as they arrive; the final chunk always
   * carries `finishReason` (and `usage` when the provider reports it).
   */
  generateStream(
    messages: Message[],
    config: GenerationConfig,
  ): AsyncGenerator<StreamChunk>;

  /**
   * Count tokens for the given messages without generating.
   * Returns undefined if the provider does not support token counting.
   */
  countTokens(
    messages: Message[],
    config: GenerationConfig,
  ): Promise<TokenUsage | undefined>;

  /** Check reachability and credential validity. */
  healthCheck(): Promise<{ ok: boolean; error?: string }>;
}

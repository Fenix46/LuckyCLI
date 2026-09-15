import type { TokenUsage } from "./providers/types.js";

export interface TokenCostRates {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion?: number;
  cacheWritePerMillion?: number;
}

export interface TokenCostEstimate {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

/** Calculate a transparent estimate from explicit caller-supplied rates. */
export function estimateTokenCost(usage: TokenUsage, rates: TokenCostRates): TokenCostEstimate {
  validateRates(rates);
  const input = perMillion(usage.inputTokens, rates.inputPerMillion);
  const output = perMillion(usage.outputTokens, rates.outputPerMillion);
  const cacheRead = perMillion(usage.cacheReadTokens ?? 0, rates.cacheReadPerMillion ?? 0);
  const cacheWrite = perMillion(usage.cacheWriteTokens ?? 0, rates.cacheWritePerMillion ?? 0);
  return {
    input: roundCost(input),
    output: roundCost(output),
    cacheRead: roundCost(cacheRead),
    cacheWrite: roundCost(cacheWrite),
    total: roundCost(input + output + cacheRead + cacheWrite),
  };
}

function perMillion(tokens: number, rate: number): number {
  if (!Number.isFinite(tokens) || tokens < 0) throw new Error("Token counts must be non-negative numbers.");
  return (tokens / 1_000_000) * rate;
}

function validateRates(rates: TokenCostRates): void {
  for (const rate of [rates.inputPerMillion, rates.outputPerMillion, rates.cacheReadPerMillion, rates.cacheWritePerMillion]) {
    if (rate !== undefined && (!Number.isFinite(rate) || rate < 0)) {
      throw new Error("Token cost rates must be non-negative numbers.");
    }
  }
}

function roundCost(value: number): number {
  return Math.round(value * 1e10) / 1e10;
}

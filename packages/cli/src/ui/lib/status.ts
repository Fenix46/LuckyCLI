import type { ContextStatus, ProviderQuotaStatus, ProviderStatus } from "@luckycli/core";
import type { CommandRow } from "./items.js";
import { formatNumber, prettyCwd } from "./format.js";

export function contextRows(status: ContextStatus): CommandRow[] {
  return [
    { label: "model", value: status.model },
    {
      label: "window",
      value: status.contextWindow ? `${formatNumber(status.contextWindow)} tokens` : "unknown",
    },
    {
      label: "usable",
      value: status.usableTokens ? `${formatNumber(status.usableTokens)} tokens` : "unknown",
    },
    {
      label: "input cap",
      value: status.maxInputTokens ? `${formatNumber(status.maxInputTokens)} tokens` : "not specified",
    },
    {
      label: "used",
      value: status.usedTokens ? `${formatNumber(status.usedTokens)} tokens` : "not available",
    },
    {
      label: "remaining",
      value: status.remainingPercentage !== undefined ? `${status.remainingPercentage}%` : "unknown",
    },
    {
      label: "turn",
      value:
        status.currentInputTokens !== undefined
          ? `${formatNumber(status.currentInputTokens)} in / ${formatNumber(status.currentOutputTokens ?? 0)} out`
          : "not available",
    },
    {
      label: "total",
      value:
        status.totalInputTokens !== undefined
          ? `${formatNumber(status.totalInputTokens)} in / ${formatNumber(status.totalOutputTokens ?? 0)} out`
          : "not available",
    },
    {
      label: "pressure",
      value: status.usedPercentage !== undefined ? `${status.usedPercentage}%` : status.ratio !== undefined ? `${Math.round(status.ratio * 100)}%` : "unknown",
    },
    { label: "counter", value: status.tokenCounter },
    { label: "source", value: status.source ?? "unknown" },
  ];
}

export function statusDetails(
  provider: ProviderStatus,
  context: ContextStatus,
): Array<{ label: string; value: string; hint?: string }> {
  return [
    { label: "Model", value: context.model },
    { label: "Directory", value: prettyCwd(process.cwd()) },
    { label: "Login", value: provider.authType },
    {
      label: "Account",
      value: provider.account ?? "not available",
      hint: provider.subscription ? `(${provider.subscription})` : undefined,
    },
    ...(provider.project ? [{ label: "Project", value: provider.project }] : []),
    ...(provider.tier ? [{ label: "Tier", value: provider.tier }] : []),
  ];
}

export function compactStatusNotes(notes: string[]): string[] {
  return notes
    .filter((note) => !note.startsWith("subscription status:"))
    .filter((note) => !note.startsWith("billing:"))
    .filter((note) => note !== "extra usage enabled")
    .map((note) => note.replace(/^organization role: /, "role: "))
    .slice(0, 4);
}

export function contextUsagePercent(context: ContextStatus): number | undefined {
  if (typeof context.ratio !== "number" || !Number.isFinite(context.ratio)) return undefined;
  return Math.round(Math.max(0, Math.min(1, context.ratio)) * 100);
}

export function contextDetail(context: ContextStatus): string | undefined {
  if (context.usedTokens !== undefined && context.usableTokens) {
    return `(${formatNumber(context.usedTokens)} / ${formatNumber(context.usableTokens)})`;
  }
  if (context.contextWindow) return `(${formatNumber(context.contextWindow)} window)`;
  return undefined;
}

export function quotaUsedPercent(quota: ProviderQuotaStatus): number | undefined {
  const match = quota.remaining?.match(/\((\d+)% used\)/);
  if (match?.[1]) return Number(match[1]);
  const remainingMatch = quota.remaining?.match(/^(\d+)% available/);
  if (remainingMatch?.[1]) return 100 - Number(remainingMatch[1]);
  return undefined;
}

export function quotaResetDetail(quota: ProviderQuotaStatus): string | undefined {
  if (!quota.resetTime) return quota.modelId ? `(model ${quota.modelId})` : undefined;
  const reset = new Date(quota.resetTime);
  const formatted = Number.isNaN(reset.getTime())
    ? quota.resetTime
    : reset.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
  return `(resets ${formatted}${quota.modelId ? ` · ${quota.modelId}` : ""})`;
}

export function quotaLabel(label: string): string {
  switch (label) {
    case "5h limit":
      return "Current session";
    case "weekly limit":
      return "Current week";
    default:
      return label;
  }
}

export function formatStatusFooter(
  status: ContextStatus | null,
  options: {
    effort?: string;
    thinking?: string;
  } = {},
): string {
  const parts = [`ctx: ${formatContextFooter(status)}`];
  if (options.effort) parts.push(`effort: ${options.effort}`);
  if (options.thinking) parts.push(`thinking: ${options.thinking}`);
  return parts.join(" ┃ ");
}

export function formatContextFooter(status: ContextStatus | null): string {
  if (!status) return "syncing…";
  if (status.usedTokens !== undefined && status.usableTokens) {
    const used = status.usedPercentage ?? Math.round((status.ratio ?? 0) * 100);
    const remaining = status.remainingPercentage ?? Math.max(0, 100 - used);
    return `${formatNumber(status.usedTokens)}/${formatNumber(status.usableTokens)} · ${remaining}% free`;
  }
  if (status.contextWindow) return `${formatNumber(status.contextWindow)} window`;
  return "syncing…";
}

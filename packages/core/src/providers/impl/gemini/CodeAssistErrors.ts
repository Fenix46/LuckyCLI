type GoogleErrorDetail = {
  "@type"?: string;
  reason?: string;
  domain?: string;
  metadata?: Record<string, string>;
  retryDelay?: string;
  violations?: Array<{ quotaId?: string }>;
};

type GoogleErrorPayload = {
  code?: number;
  message?: string;
  status?: string;
  details?: GoogleErrorDetail[];
};

export class CodeAssistRequestError extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown,
    readonly method: string,
    readonly model?: string,
  ) {
    super(formatCodeAssistRequestError(status, payload, method, model));
    this.name = "CodeAssistRequestError";
  }
}

export class CodeAssistQuotaError extends Error {
  constructor(
    message: string,
    readonly model: string | undefined,
    readonly retryDelayMs?: number,
    readonly terminal = false,
    readonly reason?: string,
  ) {
    super(message);
    this.name = "CodeAssistQuotaError";
  }
}

export class CodeAssistValidationError extends Error {
  constructor(
    message: string,
    readonly validationUrl?: string,
  ) {
    super(message);
    this.name = "CodeAssistValidationError";
  }
}

export class CodeAssistProjectRequiredError extends Error {
  constructor() {
    super(
      "This Google account requires GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_PROJECT_ID for Code Assist.",
    );
    this.name = "CodeAssistProjectRequiredError";
  }
}

export class CodeAssistInvalidProjectError extends Error {
  constructor(readonly projectId: string) {
    super(
      `Invalid Google Cloud Project ID "${projectId}". Set GOOGLE_CLOUD_PROJECT to the string project ID, not the numeric project number.`,
    );
    this.name = "CodeAssistInvalidProjectError";
  }
}

export class CodeAssistIneligibleTierError extends Error {
  constructor(readonly reasons: string[]) {
    super(reasons.join("\n"));
    this.name = "CodeAssistIneligibleTierError";
  }
}

export function classifyCodeAssistError(error: unknown): unknown {
  if (!(error instanceof CodeAssistRequestError)) return error;

  const googleError = extractGoogleError(error.payload);
  const details = googleError?.details ?? [];
  const errorInfo = details.find((d) => d["@type"]?.endsWith("ErrorInfo"));
  const retryInfo = details.find((d) => d["@type"]?.endsWith("RetryInfo"));
  const quotaFailure = details.find((d) => d["@type"]?.endsWith("QuotaFailure"));
  const retryDelayMs = parseDurationMs(retryInfo?.retryDelay);
  const reason = errorInfo?.reason ?? googleError?.status;
  const message = googleError?.message || error.message;

  if (error.status === 403 && reason === "VALIDATION_REQUIRED") {
    const validationUrl =
      errorInfo?.metadata?.validation_link ??
      details
        .flatMap((d) => {
          const links = (d as { links?: Array<{ url?: string }> }).links;
          return links?.map((link) => link.url).filter(Boolean) ?? [];
        })
        .at(0);
    return new CodeAssistValidationError(
      `Google account validation is required${validationUrl ? `: ${validationUrl}` : "."}`,
      validationUrl,
    );
  }

  if (error.status === 429 || error.status === 499 || error.status === 503) {
    const quotaId = quotaFailure?.violations?.find((v) => v.quotaId)?.quotaId;
    const terminal =
      reason === "QUOTA_EXHAUSTED" ||
      reason === "INSUFFICIENT_G1_CREDITS_BALANCE" ||
      Boolean(quotaId?.includes("PerDay") || quotaId?.includes("Daily")) ||
      Boolean(retryDelayMs && retryDelayMs > 5 * 60 * 1000);
    const delayMs =
      retryDelayMs ??
      parseRetryTextMs(message) ??
      (reason === "RATE_LIMIT_EXCEEDED" ? 10_000 : undefined);
    return new CodeAssistQuotaError(
      formatQuotaMessage(error.model, reason, delayMs, terminal),
      error.model,
      delayMs,
      terminal,
      reason,
    );
  }

  return error;
}

function extractGoogleError(payload: unknown): GoogleErrorPayload | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  if ("error" in payload) {
    const error = (payload as { error?: unknown }).error;
    return error && typeof error === "object"
      ? (error as GoogleErrorPayload)
      : undefined;
  }
  return payload as GoogleErrorPayload;
}

function formatQuotaMessage(
  model: string | undefined,
  reason: string | undefined,
  retryDelayMs: number | undefined,
  terminal: boolean,
): string {
  return [
    terminal ? "Code Assist quota exhausted" : "Code Assist rate limited",
    model ? `for ${model}` : undefined,
    reason ? `reason ${reason}` : undefined,
    retryDelayMs ? `retry in ${Math.ceil(retryDelayMs / 1000)}s` : undefined,
  ]
    .filter(Boolean)
    .join(" | ");
}

function formatCodeAssistRequestError(
  status: number,
  payload: unknown,
  method: string,
  model?: string,
): string {
  const googleError = extractGoogleError(payload);
  const message =
    googleError?.message ??
    (typeof payload === "string" ? payload : JSON.stringify(payload));
  return [
    `Code Assist request failed (${status})`,
    `method ${method}`,
    model ? `model ${model}` : undefined,
    message,
  ]
    .filter(Boolean)
    .join(": ");
}

function parseDurationMs(duration: string | undefined): number | undefined {
  if (!duration) return undefined;
  if (duration.endsWith("ms")) {
    const value = Number.parseFloat(duration.slice(0, -2));
    return Number.isFinite(value) ? value : undefined;
  }
  if (duration.endsWith("s")) {
    const value = Number.parseFloat(duration.slice(0, -1));
    return Number.isFinite(value) ? value * 1000 : undefined;
  }
  return undefined;
}

function parseRetryTextMs(message: string): number | undefined {
  const match = message.match(/retry in ([0-9.]+)(ms|s)/i);
  if (!match) return undefined;
  const amount = match[1];
  const unit = match[2];
  if (!amount || !unit) return undefined;
  const value = Number.parseFloat(amount);
  if (!Number.isFinite(value)) return undefined;
  return unit.toLowerCase() === "ms" ? value : value * 1000;
}

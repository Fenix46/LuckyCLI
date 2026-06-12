import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import * as tls from "node:tls";
import { openBrowser } from "../gemini/GoogleAuthHelper.js";
import { generatePKCE, generateState } from "../openai-oauth/pkce.js";

export const CLAUDE_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
export const CLAUDE_OAUTH_AUTHORIZE_URL = "https://claude.com/cai/oauth/authorize";
export const CLAUDE_OAUTH_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
export const CLAUDE_OAUTH_API_BASE = "https://api.anthropic.com";
export const CLAUDE_OAUTH_ROLES_URL = `${CLAUDE_OAUTH_API_BASE}/api/oauth/claude_cli/roles`;
export const CLAUDE_OAUTH_USAGE_URL = `${CLAUDE_OAUTH_API_BASE}/api/oauth/usage`;
export const CLAUDE_OAUTH_REFERRAL_CAMPAIGN = "claude_code_guest_pass";
export const CLAUDE_OAUTH_BETA_HEADER = "oauth-2025-04-20";
export const CLAUDE_CONTEXT_WINDOW_DEFAULT = 200_000;
export const CLAUDE_CONTEXT_WINDOW_1M = 1_000_000;
export const CLAUDE_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
let claudeOAuthCaLoaded = false;

export type ClaudeEffortLevel = typeof CLAUDE_EFFORT_LEVELS[number];

const CLAUDE_OAUTH_SCOPES = [
  "org:create_api_key",
  "user:profile",
  "user:inference",
  "user:sessions:claude_code",
  "user:mcp_servers",
  "user:file_upload",
];

interface ClaudeOAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
  token_uuid?: string;
  organization?: {
    uuid?: string;
    name?: string;
  };
  account?: {
    uuid?: string;
    email_address?: string;
  };
}

export interface ClaudeOAuthProfile {
  account?: {
    uuid?: string;
    full_name?: string;
    display_name?: string;
    email?: string;
    has_claude_max?: boolean;
    has_claude_pro?: boolean;
    created_at?: string;
  };
  organization?: {
    uuid?: string;
    name?: string;
    organization_type?: string;
    billing_type?: string;
    rate_limit_tier?: string;
    has_extra_usage_enabled?: boolean;
    subscription_status?: string;
    subscription_created_at?: string;
  };
  application?: {
    uuid?: string;
    name?: string;
    slug?: string;
  };
}

export interface ClaudeOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scopes?: string[];
  accountUuid?: string;
  email?: string;
  organizationUuid?: string;
  organizationName?: string;
  subscriptionType?: "pro" | "max" | "team" | "enterprise";
  rateLimitTier?: string;
  billingType?: string;
}

export interface ClaudeOAuthRoles {
  organization_uuid?: string;
  organization_name?: string;
  organization_role?: string;
  workspace_uuid?: string | null;
  workspace_name?: string | null;
  workspace_role?: string | null;
}

export interface ClaudeOAuthUsageWindow {
  utilization?: number;
  resets_at?: string;
}

export interface ClaudeOAuthExtraUsage {
  is_enabled?: boolean;
  monthly_limit?: number;
  used_credits?: number;
  utilization?: number | null;
  currency?: string;
  disabled_reason?: string | null;
}

export interface ClaudeOAuthUsage {
  five_hour?: ClaudeOAuthUsageWindow | null;
  seven_day?: ClaudeOAuthUsageWindow | null;
  seven_day_oauth_apps?: ClaudeOAuthUsageWindow | null;
  seven_day_opus?: ClaudeOAuthUsageWindow | null;
  seven_day_sonnet?: ClaudeOAuthUsageWindow | null;
  seven_day_cowork?: ClaudeOAuthUsageWindow | null;
  seven_day_omelette?: ClaudeOAuthUsageWindow | null;
  tangelo?: ClaudeOAuthUsageWindow | null;
  iguana_necktie?: ClaudeOAuthUsageWindow | null;
  omelette_promotional?: ClaudeOAuthUsageWindow | null;
  extra_usage?: ClaudeOAuthExtraUsage | null;
}

export interface ClaudeOAuthReferralEligibility {
  eligible?: boolean;
  referral_code_details?: {
    code?: string;
    campaign?: string;
    referral_link?: string;
  };
  referrer_reward?: {
    amount_minor_units?: number;
    currency?: string;
  };
  remaining_passes?: number;
}

export async function runClaudeBrowserOAuthFlow(): Promise<{ tokens: ClaudeOAuthTokens }> {
  let server!: Server;
  const port = await new Promise<number>((resolve, reject) => {
    server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") resolve(address.port);
      else reject(new Error("Failed to start Claude OAuth callback server."));
    });
    server.on("error", reject);
  });

  const pkce = await generatePKCE();
  const state = generateState();
  const redirectUri = `http://localhost:${port}/callback`;
  const url = buildClaudeAuthUrl({ redirectUri, codeChallenge: pkce.challenge, state });

  const tokenPromise = new Promise<ClaudeOAuthTokens>((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Claude OAuth timeout; authorization took too long."));
    }, 5 * 60 * 1000);

    server.on("request", async (req, res) => {
      const parsed = new URL(req.url ?? "/", `http://localhost:${port}`);
      if (parsed.pathname !== "/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const error = parsed.searchParams.get("error");
      if (error) {
        clearTimeout(timer);
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(errorHtml(error));
        server.close();
        reject(new Error(parsed.searchParams.get("error_description") ?? error));
        return;
      }

      const code = parsed.searchParams.get("code");
      const returnedState = parsed.searchParams.get("state");
      if (!code || returnedState !== state) {
        clearTimeout(timer);
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(errorHtml(!code ? "Missing authorization code." : "Invalid OAuth state."));
        server.close();
        reject(new Error(!code ? "Missing authorization code." : "Invalid OAuth state."));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(successHtml());

      try {
        const exchanged = await exchangeClaudeCodeForTokens(code, state, pkce.verifier, redirectUri);
        clearTimeout(timer);
        server.close();
        resolve(exchanged);
      } catch (e) {
        clearTimeout(timer);
        server.close();
        reject(e);
      }
    });
  });

  openBrowser(url);
  return { tokens: await tokenPromise };
}

export function buildClaudeAuthUrl({
  redirectUri,
  codeChallenge,
  state,
}: {
  redirectUri: string;
  codeChallenge: string;
  state: string;
}): string {
  const url = new URL(CLAUDE_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("code", "true");
  url.searchParams.set("client_id", CLAUDE_OAUTH_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", CLAUDE_OAUTH_SCOPES.join(" "));
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeClaudeCodeForTokens(
  code: string,
  state: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<ClaudeOAuthTokens> {
  const token = await postClaudeToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: CLAUDE_OAUTH_CLIENT_ID,
    code_verifier: codeVerifier,
    state,
  });
  const profile = await fetchClaudeOAuthProfile(token.access_token).catch(() => undefined);
  return tokensFromResponse(token, profile);
}

export async function refreshClaudeOAuthToken(
  refreshToken: string,
): Promise<ClaudeOAuthTokens> {
  const token = await postClaudeToken({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: CLAUDE_OAUTH_CLIENT_ID,
    scope: CLAUDE_OAUTH_SCOPES.filter((scope) => scope !== "org:create_api_key").join(" "),
  });
  const profile = await fetchClaudeOAuthProfile(token.access_token).catch(() => undefined);
  return tokensFromResponse(token, profile, refreshToken);
}

export async function fetchClaudeOAuthProfile(accessToken: string): Promise<ClaudeOAuthProfile> {
  const res = await claudeFetch(`${CLAUDE_OAUTH_API_BASE}/api/oauth/profile`, {
    method: "GET",
    headers: authHeaders(accessToken, { "Content-Type": "application/json" }),
  }, "Claude OAuth profile");
  if (!res.ok) {
    throw new Error(`Claude OAuth profile failed (${res.status}): ${await res.text()}`);
  }
  return res.json() as Promise<ClaudeOAuthProfile>;
}

export async function fetchClaudeOAuthRoles(accessToken: string): Promise<ClaudeOAuthRoles> {
  const res = await claudeFetch(CLAUDE_OAUTH_ROLES_URL, {
    method: "GET",
    headers: authHeaders(accessToken),
  }, "Claude OAuth roles");
  if (!res.ok) {
    throw new Error(`Claude OAuth roles failed (${res.status}): ${await res.text()}`);
  }
  return res.json() as Promise<ClaudeOAuthRoles>;
}

export async function fetchClaudeOAuthUsage(accessToken: string): Promise<ClaudeOAuthUsage> {
  const res = await claudeFetch(CLAUDE_OAUTH_USAGE_URL, {
    method: "GET",
    headers: authHeaders(accessToken, {
      "anthropic-beta": CLAUDE_OAUTH_BETA_HEADER,
      "Content-Type": "application/json",
      "User-Agent": "claude-cli/2.1.175 (external, cli)",
    }),
  }, "Claude OAuth usage");
  if (!res.ok) {
    throw new Error(`Claude OAuth usage failed (${res.status}): ${await res.text()}`);
  }
  return res.json() as Promise<ClaudeOAuthUsage>;
}

export async function fetchClaudeOAuthReferralEligibility(
  accessToken: string,
  organizationUuid: string,
  campaign = CLAUDE_OAUTH_REFERRAL_CAMPAIGN,
): Promise<ClaudeOAuthReferralEligibility> {
  const url = new URL(
    `${CLAUDE_OAUTH_API_BASE}/api/oauth/organizations/${organizationUuid}/referral/eligibility`,
  );
  url.searchParams.set("campaign", campaign);
  const res = await claudeFetch(
    url.toString(),
    {
      method: "GET",
      headers: authHeaders(accessToken, {
        "anthropic-client-platform": "claude_code_cli",
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
        "User-Agent": "claude-cli/2.1.175 (external, cli)",
        "x-organization-uuid": organizationUuid,
      }),
    },
    "Claude OAuth referral eligibility",
  );
  if (!res.ok) {
    throw new Error(`Claude OAuth referral eligibility failed (${res.status}): ${await res.text()}`);
  }
  return res.json() as Promise<ClaudeOAuthReferralEligibility>;
}

async function postClaudeToken(body: Record<string, string>): Promise<ClaudeOAuthTokenResponse> {
  const res = await claudeFetch(CLAUDE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      "User-Agent": "axios/1.15.2",
    },
    body: JSON.stringify(body),
  }, "Claude OAuth token request");
  if (!res.ok) {
    throw new Error(`Claude OAuth token request failed (${res.status}): ${await res.text()}`);
  }
  return res.json() as Promise<ClaudeOAuthTokenResponse>;
}

async function claudeFetch(
  url: string,
  init: RequestInit,
  label: string,
): Promise<Response> {
  ensureClaudeOAuthCa();
  try {
    return await fetch(url, init);
  } catch (e) {
    throw new Error(`${label} fetch failed: ${describeError(e)}`);
  }
}

function authHeaders(accessToken: string, extra?: Record<string, string>): Record<string, string> {
  return {
    accept: "application/json, text/plain, */*",
    Authorization: `Bearer ${accessToken}`,
    ...extra,
  };
}

function ensureClaudeOAuthCa(): void {
  if (claudeOAuthCaLoaded) return;
  claudeOAuthCaLoaded = true;

  const extraCaPaths = [
    ...(process.env.NODE_EXTRA_CA_CERTS ? [process.env.NODE_EXTRA_CA_CERTS] : []),
    join(homedir(), "Library", "Preferences", "httptoolkit", "ca.pem"),
  ];
  const extraCerts = extraCaPaths
    .filter((path) => existsSync(path))
    .map((path) => readFileSync(path, "utf8"));

  if (!extraCerts.length || !tls.setDefaultCACertificates || !tls.getCACertificates) return;
  tls.setDefaultCACertificates([...tls.getCACertificates("default"), ...extraCerts]);
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  if (cause instanceof Error && cause.message) return `${error.message}: ${cause.message}`;
  if (cause && typeof cause === "object" && "message" in cause) {
    return `${error.message}: ${String((cause as { message: unknown }).message)}`;
  }
  return error.message;
}

function tokensFromResponse(
  token: ClaudeOAuthTokenResponse,
  profile?: ClaudeOAuthProfile,
  previousRefreshToken?: string,
): ClaudeOAuthTokens {
  return {
    accessToken: token.access_token,
    ...(token.refresh_token ?? previousRefreshToken
      ? { refreshToken: token.refresh_token ?? previousRefreshToken }
      : {}),
    expiresAt: Date.now() + token.expires_in * 1000,
    scopes: token.scope?.split(" ").filter(Boolean) ?? [],
    ...(profile?.account?.uuid ?? token.account?.uuid
      ? { accountUuid: profile?.account?.uuid ?? token.account?.uuid }
      : {}),
    ...(profile?.account?.email ?? token.account?.email_address
      ? { email: profile?.account?.email ?? token.account?.email_address }
      : {}),
    ...(profile?.organization?.uuid ?? token.organization?.uuid
      ? { organizationUuid: profile?.organization?.uuid ?? token.organization?.uuid }
      : {}),
    ...(profile?.organization?.name ?? token.organization?.name
      ? { organizationName: profile?.organization?.name ?? token.organization?.name }
      : {}),
    ...(subscriptionType(profile?.organization?.organization_type)
      ? { subscriptionType: subscriptionType(profile?.organization?.organization_type) }
      : {}),
    ...(profile?.organization?.rate_limit_tier ? { rateLimitTier: profile.organization.rate_limit_tier } : {}),
    ...(profile?.organization?.billing_type ? { billingType: profile.organization.billing_type } : {}),
  };
}

export function claudeContextWindowForModel(model: string): number {
  if (process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS) {
    const override = Number.parseInt(process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS, 10);
    if (Number.isInteger(override) && override > 0) return override;
  }

  if (isClaude1mContextDisabled()) return CLAUDE_CONTEXT_WINDOW_DEFAULT;
  if (hasExplicitClaude1mSuffix(model)) return CLAUDE_CONTEXT_WINDOW_1M;
  if (modelSupportsClaude1m(model)) return CLAUDE_CONTEXT_WINDOW_1M;
  return CLAUDE_CONTEXT_WINDOW_DEFAULT;
}

export function claudeEffortLevelsForModel(model: string): ClaudeEffortLevel[] {
  return claudeModelSupportsEffort(model) ? [...CLAUDE_EFFORT_LEVELS] : [];
}

export function claudeModelSupportsEffort(model: string): boolean {
  const canonical = model.toLowerCase();
  return (
    canonical.includes("sonnet-4-6") ||
    canonical.includes("opus-4-6") ||
    canonical.includes("opus-4-8") ||
    canonical.includes("fable")
  );
}

export function claudeModelSupportsAdaptiveThinking(model: string): boolean {
  return claudeModelSupportsEffort(model);
}

export function claudeModelSupportsMaxEffort(model: string): boolean {
  const canonical = model.toLowerCase();
  return canonical.includes("opus-4") || canonical.includes("fable");
}

export function normalizeClaudeEffort(
  model: string,
  effort: string | undefined,
): "low" | "medium" | "high" | "max" | undefined {
  if (!effort || !claudeModelSupportsEffort(model)) return undefined;
  const normalized = effort.trim().toLowerCase();
  switch (normalized) {
    case "low":
    case "medium":
    case "high":
      return normalized;
    case "xhigh":
    case "max":
      return claudeModelSupportsMaxEffort(model) ? "max" : "high";
    default:
      return undefined;
  }
}

export function isClaude1mContextDisabled(): boolean {
  return isTruthyEnv(process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT);
}

function hasExplicitClaude1mSuffix(model: string): boolean {
  return /\[1m\]/i.test(model);
}

function modelSupportsClaude1m(model: string): boolean {
  const canonical = model.toLowerCase();
  return canonical.includes("claude-sonnet-4") || canonical.includes("opus-4-6") || canonical.includes("opus-4-8");
}

function isTruthyEnv(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

export function subscriptionType(
  organizationType: string | undefined,
): ClaudeOAuthTokens["subscriptionType"] | undefined {
  switch (organizationType) {
    case "claude_pro":
      return "pro";
    case "claude_max":
      return "max";
    case "claude_team":
      return "team";
    case "claude_enterprise":
      return "enterprise";
    default:
      return undefined;
  }
}

function successHtml(): string {
  return `<!doctype html><html><head><title>LuckyCLI Claude Authorization Successful</title></head><body><h1>Authorization Successful</h1><p>You can close this window and return to LuckyCLI.</p><script>setTimeout(()=>window.close(),2000)</script></body></html>`;
}

function errorHtml(message: string): string {
  return `<!doctype html><html><head><title>LuckyCLI Claude Authorization Failed</title></head><body><h1>Authorization Failed</h1><pre>${escapeHtml(message)}</pre></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

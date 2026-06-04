import type { PkceCodes } from "./pkce.js";

export const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const ISSUER = "https://auth.openai.com";
export const CODEX_API_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";
export const CODEX_MODELS_ENDPOINT = "https://chatgpt.com/backend-api/codex/models";
export const OAUTH_CALLBACK_PORT = 1455;
/** Codex client version advertised to the backend (User-Agent + ?client_version=). */
export const CODEX_CLIENT_VERSION = "0.135.0";

export interface TokenResponse {
  id_token: string;
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}

export interface OpenAiOAuthTokens {
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
}

interface IdTokenClaims {
  chatgpt_account_id?: string;
  organizations?: Array<{ id: string }>;
  "https://api.openai.com/auth"?: { chatgpt_account_id?: string };
}

function parseJwtClaims(token: string): IdTokenClaims | undefined {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return undefined;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString()) as IdTokenClaims;
  } catch {
    return undefined;
  }
}

export function extractAccountId(tokens: TokenResponse): string | undefined {
  for (const token of [tokens.id_token, tokens.access_token]) {
    if (!token) continue;
    const claims = parseJwtClaims(token);
    const id =
      claims?.chatgpt_account_id ??
      claims?.["https://api.openai.com/auth"]?.chatgpt_account_id ??
      claims?.organizations?.[0]?.id;
    if (id) return id;
  }
  return undefined;
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
  pkce: PkceCodes,
): Promise<TokenResponse> {
  const res = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      code_verifier: pkce.verifier,
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`OpenAI OAuth token exchange failed (${res.status}): ${await res.text()}`);
  }
  return res.json() as Promise<TokenResponse>;
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<TokenResponse> {
  const res = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`OpenAI OAuth token refresh failed (${res.status}): ${await res.text()}`);
  }
  return res.json() as Promise<TokenResponse>;
}

export function tokensToOAuth(tokens: TokenResponse): OpenAiOAuthTokens {
  return {
    access: tokens.access_token,
    refresh: tokens.refresh_token,
    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    ...(extractAccountId(tokens) ? { accountId: extractAccountId(tokens) } : {}),
  };
}

export function isExpired(tokens: OpenAiOAuthTokens): boolean {
  return tokens.expires - Date.now() < 5 * 60 * 1000;
}

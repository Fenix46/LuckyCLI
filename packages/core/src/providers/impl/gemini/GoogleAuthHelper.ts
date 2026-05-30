import { OAuth2Client, CodeChallengeMethod } from "google-auth-library";
import crypto from "node:crypto";

const OAUTH_CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com";
const OAUTH_CLIENT_SECRET = "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";
const OAUTH_SCOPE = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

export interface OAuthSession {
  url: string;
  codeVerifier: string;
}

/**
 * Generates the Google OAuth authorization URL and a secure PKCE code verifier.
 */
export async function startOAuthFlow(): Promise<OAuthSession> {
  const client = new OAuth2Client({
    clientId: OAUTH_CLIENT_ID,
    clientSecret: OAUTH_CLIENT_SECRET,
  });

  const redirectUri = "https://codeassist.google.com/authcode";
  const verifier = await client.generateCodeVerifierAsync();
  const state = crypto.randomBytes(32).toString("hex");

  const url = client.generateAuthUrl({
    redirect_uri: redirectUri,
    access_type: "offline",
    scope: OAUTH_SCOPE,
    code_challenge_method: CodeChallengeMethod.S256,
    code_challenge: verifier.codeChallenge,
    state,
  });

  return {
    url,
    codeVerifier: verifier.codeVerifier,
  };
}

/**
 * Exchanges the user-provided copy-paste authorization code for access and refresh tokens.
 */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
): Promise<{ accessToken: string; refreshToken?: string }> {
  const client = new OAuth2Client({
    clientId: OAUTH_CLIENT_ID,
    clientSecret: OAUTH_CLIENT_SECRET,
  });

  const redirectUri = "https://codeassist.google.com/authcode";
  const { tokens } = await client.getToken({
    code,
    codeVerifier,
    redirect_uri: redirectUri,
  });

  return {
    accessToken: tokens.access_token || "",
    refreshToken: tokens.refresh_token || undefined,
  };
}

/**
 * Refreshes an expired access token using the stored refresh token.
 */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<string> {
  const client = new OAuth2Client({
    clientId: OAUTH_CLIENT_ID,
    clientSecret: OAUTH_CLIENT_SECRET,
  });

  client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await client.refreshAccessToken();
  return credentials.access_token || "";
}

import { openBrowser } from "../gemini/GoogleAuthHelper.js";
import { generatePKCE, generateState } from "./pkce.js";
import {
  getRedirectUri,
  startCallbackServer,
  stopCallbackServer,
  waitForCallback,
} from "./callbackServer.js";
import { CLIENT_ID, ISSUER, tokensToOAuth, type OpenAiOAuthTokens } from "./tokens.js";

export interface OpenAiOAuthFlowResult {
  tokens: OpenAiOAuthTokens;
}

export async function runOpenAiBrowserOAuthFlow(): Promise<OpenAiOAuthFlowResult> {
  await startCallbackServer();

  const pkce = await generatePKCE();
  const state = generateState();
  const redirectUri = getRedirectUri();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access",
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
    originator: "luckycli",
  });

  openBrowser(`${ISSUER}/oauth/authorize?${params.toString()}`);

  try {
    return { tokens: tokensToOAuth(await waitForCallback(pkce, state)) };
  } finally {
    stopCallbackServer();
  }
}

import { useEffect, useRef, useState } from "react";
import {
  openBrowser,
  runClaudeBrowserOAuthFlow,
  runOpenAiBrowserOAuthFlow,
  startAntigravityOAuthFlow,
  startOAuthFlow,
  type AuthMethod,
  type ClaudeOAuthTokens,
  type OpenAiOAuthTokens,
  type ProviderId,
} from "@luckycli/core";
import type { GoogleStyleOAuthTokens } from "../lib/setup-credentials.js";

/** The browser flows the setup step drives, injectable so tests stay offline. */
export interface SetupOAuthDeps {
  runOpenAiBrowserOAuthFlow: typeof runOpenAiBrowserOAuthFlow;
  runClaudeBrowserOAuthFlow: typeof runClaudeBrowserOAuthFlow;
  startAntigravityOAuthFlow: typeof startAntigravityOAuthFlow;
  startOAuthFlow: typeof startOAuthFlow;
  openBrowser: typeof openBrowser;
}

const defaultDeps: SetupOAuthDeps = {
  runOpenAiBrowserOAuthFlow,
  runClaudeBrowserOAuthFlow,
  startAntigravityOAuthFlow,
  startOAuthFlow,
  openBrowser,
};

/** Tokens produced by a completed flow — exactly one field is ever set. */
export interface SetupOAuthTokens {
  google?: GoogleStyleOAuthTokens;
  antigravity?: GoogleStyleOAuthTokens;
  claude?: ClaudeOAuthTokens;
  openAi?: OpenAiOAuthTokens;
}

/** The side effects the flow reports back to the caller. */
export interface SetupOAuthFlowCallbacks {
  setLoading: (loading: boolean) => void;
  /** Authorization URL to display, for the flows that show one. */
  setUrl: (url: string) => void;
  setError: (message: string) => void;
  /** Tokens are in hand; the wizard may advance to the model step. */
  onTokens: (tokens: SetupOAuthTokens) => void;
}

/** Uniform message for a failed browser flow. */
export function authFailureMessage(err: unknown): string {
  return `Authentication failed: ${err instanceof Error ? err.message : String(err)}`;
}

export const INCOMPLETE_OAUTH_MESSAGE =
  "Authentication is incomplete. Please restart setup and try again.";

/**
 * Run the provider's browser OAuth flow. Resolves once the flow settled; on
 * failure it reports the message through `setError` rather than rejecting, so
 * the caller can simply clear its "already started" latch and let the user
 * retry. The returned `stop` tears down a still-listening callback server.
 */
export async function runSetupOAuthFlow(
  provider: ProviderId | null,
  cb: SetupOAuthFlowCallbacks,
  deps: SetupOAuthDeps = defaultDeps,
): Promise<{ ok: boolean; stop?: () => void }> {
  type OAuthSession = Awaited<ReturnType<typeof startOAuthFlow>>;
  let session: OAuthSession | null = null;
  try {
    if (provider === "openai-oauth") {
      const { tokens } = await deps.runOpenAiBrowserOAuthFlow();
      cb.setLoading(false);
      cb.onTokens({ openAi: tokens });
      return { ok: true };
    }

    if (provider === "claude") {
      const { tokens } = await deps.runClaudeBrowserOAuthFlow();
      cb.setLoading(false);
      cb.onTokens({ claude: tokens });
      return { ok: true };
    }

    const isAntigravity = provider === "antigravity";
    session = isAntigravity
      ? await deps.startAntigravityOAuthFlow()
      : await deps.startOAuthFlow();
    cb.setUrl(session.url);
    cb.setLoading(false);
    deps.openBrowser(session.url);

    const tokens = await session.tokenPromise;
    if (!tokens.accessToken) throw new Error("Google did not return an access token.");
    // Antigravity refreshes its short-lived token constantly; without a refresh
    // token the credentials would stop working within the hour.
    if (isAntigravity && !tokens.refreshToken) {
      throw new Error("Google did not return a refresh token. Re-consent is required.");
    }
    cb.onTokens(isAntigravity ? { antigravity: tokens } : { google: tokens });
    return { ok: true, stop: () => session?.stop() };
  } catch (err) {
    cb.setLoading(false);
    cb.setError(authFailureMessage(err));
    return { ok: false, ...(session ? { stop: () => session?.stop() } : {}) };
  }
}

export interface UseSetupOAuthOptions {
  provider: ProviderId | null;
  authMethod: AuthMethod | null;
  /** The flow only runs while the wizard sits on the credential step. */
  active: boolean;
  /** Called once tokens are in hand, to advance to the model step. */
  onAuthenticated: () => void;
  deps?: SetupOAuthDeps;
}

/** Tokens collected by whichever browser flow ran, plus its UI state. */
export interface SetupOAuthState {
  googleOAuthTokens: GoogleStyleOAuthTokens | null;
  antigravityOAuthTokens: GoogleStyleOAuthTokens | null;
  claudeOAuthTokens: ClaudeOAuthTokens | null;
  openAiOAuthTokens: OpenAiOAuthTokens | null;
  oauthUrl: string | null;
  oauthError: string | null;
  oauthLoading: boolean;
  /** Clear tokens, errors and the "already started" latch. */
  reset: () => void;
  /** Surface the "you never finished logging in" message. */
  setIncompleteError: () => void;
}

/**
 * Runs the provider's browser OAuth flow once the wizard reaches the credential
 * step, and holds the resulting tokens. A "started" latch keeps a re-render
 * from opening a second browser window; a failure clears it so the user can
 * retry by stepping back and forward again.
 */
export function useSetupOAuth({
  provider,
  authMethod,
  active,
  onAuthenticated,
  deps = defaultDeps,
}: UseSetupOAuthOptions): SetupOAuthState {
  const [oauthUrl, setOauthUrl] = useState<string | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [googleOAuthTokens, setGoogleOAuthTokens] = useState<GoogleStyleOAuthTokens | null>(null);
  const [antigravityOAuthTokens, setAntigravityOAuthTokens] =
    useState<GoogleStyleOAuthTokens | null>(null);
  const [claudeOAuthTokens, setClaudeOAuthTokens] = useState<ClaudeOAuthTokens | null>(null);
  const [openAiOAuthTokens, setOpenAiOAuthTokens] = useState<OpenAiOAuthTokens | null>(null);
  const startedRef = useRef(false);

  // `onAuthenticated` is a fresh closure each render; keep it out of the effect
  // deps so completing a flow never re-triggers it.
  const onAuthenticatedRef = useRef(onAuthenticated);
  onAuthenticatedRef.current = onAuthenticated;

  useEffect(() => {
    if (authMethod?.kind !== "oauth" || !active || startedRef.current) return;
    startedRef.current = true;
    setOauthLoading(true);
    setOauthError(null);

    let stop: (() => void) | undefined;
    let cancelled = false;
    void runSetupOAuthFlow(
      provider,
      {
        setLoading: setOauthLoading,
        setUrl: setOauthUrl,
        setError: setOauthError,
        onTokens: (tokens) => {
          if (cancelled) return;
          if (tokens.google) setGoogleOAuthTokens(tokens.google);
          if (tokens.antigravity) setAntigravityOAuthTokens(tokens.antigravity);
          if (tokens.claude) setClaudeOAuthTokens(tokens.claude);
          if (tokens.openAi) setOpenAiOAuthTokens(tokens.openAi);
          onAuthenticatedRef.current();
        },
      },
      deps,
    ).then((result) => {
      // Let the user retry a failed login by stepping back and forward again.
      if (!result.ok) startedRef.current = false;
      stop = result.stop;
      if (cancelled) stop?.();
    });

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [authMethod?.id, authMethod?.kind, provider, active, deps]);

  function reset() {
    setOauthUrl(null);
    setOauthError(null);
    setGoogleOAuthTokens(null);
    setAntigravityOAuthTokens(null);
    setClaudeOAuthTokens(null);
    setOpenAiOAuthTokens(null);
    startedRef.current = false;
  }

  return {
    googleOAuthTokens,
    antigravityOAuthTokens,
    claudeOAuthTokens,
    openAiOAuthTokens,
    oauthUrl,
    oauthError,
    oauthLoading,
    reset,
    setIncompleteError: () => setOauthError(INCOMPLETE_OAUTH_MESSAGE),
  };
}

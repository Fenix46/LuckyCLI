import { describe, expect, it, vi } from "vitest";
import {
  authFailureMessage,
  runSetupOAuthFlow,
  type SetupOAuthDeps,
  type SetupOAuthFlowCallbacks,
  type SetupOAuthTokens,
} from "./useSetupOAuth.js";

function session(url = "https://auth.example/authorize", tokens: unknown = { accessToken: "at" }) {
  return {
    url,
    tokenPromise: Promise.resolve(tokens),
    stop: vi.fn(),
  };
}

function deps(overrides: Partial<SetupOAuthDeps> = {}): SetupOAuthDeps {
  return {
    runOpenAiBrowserOAuthFlow: vi.fn(async () => ({ tokens: { accessToken: "openai-at" } })),
    runClaudeBrowserOAuthFlow: vi.fn(async () => ({ tokens: { accessToken: "claude-at" } })),
    startAntigravityOAuthFlow: vi.fn(async () =>
      session("https://ag", { accessToken: "at", refreshToken: "rt" }),
    ),
    startOAuthFlow: vi.fn(async () => session()),
    openBrowser: vi.fn(),
    ...overrides,
  } as unknown as SetupOAuthDeps;
}

function callbacks(): {
  cb: SetupOAuthFlowCallbacks;
  loading: boolean[];
  urls: string[];
  errors: string[];
  tokens: SetupOAuthTokens[];
} {
  const loading: boolean[] = [];
  const urls: string[] = [];
  const errors: string[] = [];
  const tokens: SetupOAuthTokens[] = [];
  return {
    loading,
    urls,
    errors,
    tokens,
    cb: {
      setLoading: (v) => loading.push(v),
      setUrl: (v) => urls.push(v),
      setError: (v) => errors.push(v),
      onTokens: (v) => tokens.push(v),
    },
  };
}

describe("runSetupOAuthFlow", () => {
  it("returns openai tokens without showing an authorization url", async () => {
    const { cb, tokens, urls } = callbacks();
    const result = await runSetupOAuthFlow("openai-oauth", cb, deps());
    expect(result.ok).toBe(true);
    expect(tokens).toEqual([{ openAi: { accessToken: "openai-at" } }]);
    expect(urls).toEqual([]);
  });

  it("returns claude tokens", async () => {
    const { cb, tokens } = callbacks();
    await runSetupOAuthFlow("claude", cb, deps());
    expect(tokens).toEqual([{ claude: { accessToken: "claude-at" } }]);
  });

  it("shows the url and opens the browser for the google flow", async () => {
    const d = deps();
    const { cb, urls, tokens, loading } = callbacks();
    await runSetupOAuthFlow("gemini", cb, d);
    expect(urls).toEqual(["https://auth.example/authorize"]);
    expect(d.openBrowser).toHaveBeenCalledWith("https://auth.example/authorize");
    expect(tokens).toEqual([{ google: { accessToken: "at" } }]);
    // Loading clears as soon as the url is displayed, not only at the end.
    expect(loading).toContain(false);
  });

  it("routes antigravity tokens to their own field", async () => {
    const { cb, tokens } = callbacks();
    await runSetupOAuthFlow("antigravity", cb, deps());
    expect(tokens).toEqual([{ antigravity: { accessToken: "at", refreshToken: "rt" } }]);
  });

  it("rejects antigravity logins that come back without a refresh token", async () => {
    const d = deps({
      startAntigravityOAuthFlow: vi.fn(async () =>
        session("https://ag", { accessToken: "at" }),
      ),
    } as unknown as Partial<SetupOAuthDeps>);
    const { cb, errors, tokens } = callbacks();
    const result = await runSetupOAuthFlow("antigravity", cb, d);
    expect(result.ok).toBe(false);
    expect(tokens).toEqual([]);
    expect(errors[0]).toContain("refresh token");
  });

  it("accepts a google login without a refresh token", async () => {
    const d = deps({
      startOAuthFlow: vi.fn(async () => session("https://g", { accessToken: "at" })),
    } as unknown as Partial<SetupOAuthDeps>);
    const { cb, tokens } = callbacks();
    const result = await runSetupOAuthFlow("gemini", cb, d);
    expect(result.ok).toBe(true);
    expect(tokens).toEqual([{ google: { accessToken: "at" } }]);
  });

  it("fails when the callback returns no access token", async () => {
    const d = deps({
      startOAuthFlow: vi.fn(async () => session("https://g", {})),
    } as unknown as Partial<SetupOAuthDeps>);
    const { cb, errors } = callbacks();
    const result = await runSetupOAuthFlow("gemini", cb, d);
    expect(result.ok).toBe(false);
    expect(errors[0]).toContain("access token");
  });

  it("reports a thrown flow error instead of rejecting", async () => {
    const d = deps({
      runClaudeBrowserOAuthFlow: vi.fn(async () => {
        throw new Error("browser closed");
      }),
    } as unknown as Partial<SetupOAuthDeps>);
    const { cb, errors, loading } = callbacks();
    const result = await runSetupOAuthFlow("claude", cb, d);
    expect(result.ok).toBe(false);
    expect(errors).toEqual(["Authentication failed: browser closed"]);
    expect(loading.at(-1)).toBe(false);
  });

  it("hands back a stop function so a listening callback server can be torn down", async () => {
    const s = session();
    const d = deps({ startOAuthFlow: vi.fn(async () => s) } as unknown as Partial<SetupOAuthDeps>);
    const { cb } = callbacks();
    const result = await runSetupOAuthFlow("gemini", cb, d);
    result.stop?.();
    expect(s.stop).toHaveBeenCalled();
  });

  it("still exposes stop when the flow failed after the server started", async () => {
    const s = session("https://g", {});
    const d = deps({ startOAuthFlow: vi.fn(async () => s) } as unknown as Partial<SetupOAuthDeps>);
    const { cb } = callbacks();
    const result = await runSetupOAuthFlow("gemini", cb, d);
    expect(result.ok).toBe(false);
    result.stop?.();
    expect(s.stop).toHaveBeenCalled();
  });
});

describe("authFailureMessage", () => {
  it("uses the error message when there is one", () => {
    expect(authFailureMessage(new Error("nope"))).toBe("Authentication failed: nope");
  });

  it("stringifies non-errors", () => {
    expect(authFailureMessage("boom")).toBe("Authentication failed: boom");
  });
});

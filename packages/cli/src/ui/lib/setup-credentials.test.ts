import { describe, expect, it } from "vitest";
import type { AuthMethod, ProviderCredentials } from "@luckycli/core";
import {
  buildCredentials,
  credentialSubtitle,
  providerLabel,
  savedCredentialsLabel,
  type SetupFormState,
} from "./setup-credentials.js";

function form(overrides: Partial<SetupFormState> = {}): SetupFormState {
  return {
    secret: "",
    apiKeySecret: "",
    contextWindow: "",
    discoveredContextByModel: {},
    gcpProjectId: "",
    gcpRegion: "",
    googleOAuthTokens: null,
    antigravityOAuthTokens: null,
    claudeOAuthTokens: null,
    openAiOAuthTokens: null,
    ...overrides,
  };
}

const apiKeyMethod: AuthMethod = {
  id: "api_key",
  kind: "apiKey",
  displayName: "API Key",
};
const oauthMethod: AuthMethod = { id: "oauth", kind: "oauth", displayName: "OAuth" };
const vertexMethod: AuthMethod = { id: "vertex", kind: "vertex", displayName: "Vertex AI" };
const baseUrlMethod: AuthMethod = {
  id: "base_url",
  kind: "baseUrl",
  displayName: "Base URL",
};

describe("buildCredentials", () => {
  it("trims the api key for simple key providers", () => {
    expect(
      buildCredentials("openai", apiKeyMethod, "gpt-5.5", form({ secret: "  sk-abc  " })),
    ).toEqual({ type: "openai", apiKey: "sk-abc" });
  });

  it("returns undefined when an OAuth flow never completed", () => {
    expect(buildCredentials("claude", oauthMethod, "m", form())).toBeUndefined();
    expect(buildCredentials("openai-oauth", oauthMethod, "m", form())).toBeUndefined();
    expect(buildCredentials("gemini", oauthMethod, "m", form())).toBeUndefined();
  });

  it("requires a refresh token for antigravity, not just an access token", () => {
    const accessOnly = form({
      antigravityOAuthTokens: { accessToken: "at" },
    });
    expect(buildCredentials("antigravity", oauthMethod, "m", accessOnly)).toBeUndefined();

    const full = form({
      antigravityOAuthTokens: { accessToken: "at", refreshToken: "rt", expiresAt: 42 },
    });
    expect(buildCredentials("antigravity", oauthMethod, "m", full)).toEqual({
      type: "antigravity",
      authMethod: "oauth",
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: 42,
    });
  });

  it("omits optional gemini oauth fields when absent", () => {
    const creds = buildCredentials(
      "gemini",
      oauthMethod,
      "m",
      form({ googleOAuthTokens: { accessToken: "at" } }),
    );
    expect(creds).toEqual({ type: "gemini", authMethod: "oauth", accessToken: "at" });
  });

  it("builds vertex credentials, dropping a blank region", () => {
    expect(
      buildCredentials(
        "gemini",
        vertexMethod,
        "m",
        form({ gcpProjectId: " proj ", gcpRegion: "  " }),
      ),
    ).toEqual({ type: "gemini", authMethod: "vertex", projectId: "proj" });
  });

  it("ignores a blank, zero or non-numeric context window override", () => {
    for (const raw of ["", "   ", "0", "-5", "abc"]) {
      expect(
        buildCredentials(
          "llamacpp",
          baseUrlMethod,
          "m",
          form({ secret: "http://localhost:8080", contextWindow: raw }),
        ),
      ).toEqual({ type: "llamacpp", baseUrl: "http://localhost:8080" });
    }
  });

  it("applies a valid context window override", () => {
    expect(
      buildCredentials(
        "vllm",
        baseUrlMethod,
        "m",
        form({ secret: "http://x", apiKeySecret: "k", contextWindow: " 8192 " }),
      ),
    ).toEqual({ type: "vllm", baseUrl: "http://x", apiKey: "k", contextWindow: 8192 });
  });

  it("prefers a manual context window over the discovered one for ollama", () => {
    expect(
      buildCredentials(
        "ollama",
        baseUrlMethod,
        "llama3",
        form({
          secret: "http://localhost:11434",
          contextWindow: "4096",
          discoveredContextByModel: { llama3: 131072 },
        }),
      ),
    ).toEqual({ type: "ollama", baseUrl: "http://localhost:11434", contextWindow: 4096 });
  });

  it("falls back to the discovered context window for ollama", () => {
    expect(
      buildCredentials(
        "ollama",
        baseUrlMethod,
        "llama3",
        form({
          secret: "http://localhost:11434",
          discoveredContextByModel: { llama3: 131072 },
        }),
      ),
    ).toEqual({ type: "ollama", baseUrl: "http://localhost:11434", contextWindow: 131072 });
  });

  it("only uses the discovered window of the selected model", () => {
    const creds = buildCredentials(
      "openrouter",
      apiKeyMethod,
      "model-a",
      form({ secret: "key", discoveredContextByModel: { "model-b": 200000 } }),
    );
    expect(creds).toEqual({ type: "openrouter", apiKey: "key" });
  });

  it("lets opencode-zen proceed with no api key (public tier)", () => {
    expect(buildCredentials("opencode-zen", apiKeyMethod, "m", form())).toEqual({
      type: "opencode-zen",
    });
  });

  it("keeps the openai-compatible api key even when empty", () => {
    expect(
      buildCredentials(
        "openai-compatible",
        baseUrlMethod,
        "m",
        form({ secret: "http://x", apiKeySecret: "" }),
      ),
    ).toEqual({ type: "openai-compatible", baseUrl: "http://x", apiKey: "" });
  });

  it("distinguishes claude oauth from claude api key", () => {
    expect(
      buildCredentials("claude", apiKeyMethod, "m", form({ secret: "sk-ant" })),
    ).toEqual({ type: "claude", authMethod: "api_key", apiKey: "sk-ant" });

    const oauth = buildCredentials(
      "claude",
      oauthMethod,
      "m",
      form({ claudeOAuthTokens: { accessToken: "at", refreshToken: "rt", expiresAt: 1 } }),
    );
    expect(oauth).toMatchObject({ type: "claude", authMethod: "oauth", accessToken: "at" });
  });
});

describe("providerLabel", () => {
  it("uses friendly aliases for the oauth-account providers", () => {
    expect(providerLabel("openai-oauth")).toBe("ChatGPT Plus/Pro");
    expect(providerLabel("antigravity")).toBe("Google Antigravity");
  });

  it("collapses Google-company providers to a single label", () => {
    expect(providerLabel("gemini")).toBe("Google Gemini");
  });
});

describe("savedCredentialsLabel", () => {
  it("prefers the email for a claude oauth session", () => {
    expect(
      savedCredentialsLabel({
        type: "claude",
        authMethod: "oauth",
        accessToken: "at",
        email: "a@b.c",
      } as ProviderCredentials),
    ).toBe("OAuth: a@b.c");
  });

  it("masks api keys", () => {
    expect(
      savedCredentialsLabel({ type: "openai", apiKey: "sk-1234567890" }),
    ).toBe("API Key: sk-1...7890");
  });

  it("shows the base url for local providers", () => {
    expect(savedCredentialsLabel({ type: "ollama", baseUrl: "http://localhost:11434" })).toBe(
      "Local URL: http://localhost:11434",
    );
  });
});

describe("credentialSubtitle", () => {
  it("names the browser target per oauth provider", () => {
    expect(credentialSubtitle("claude", oauthMethod)).toContain("Claude subscription");
    expect(credentialSubtitle("openai-oauth", oauthMethod)).toContain("ChatGPT account");
    expect(credentialSubtitle("antigravity", oauthMethod)).toContain("Google Antigravity");
    expect(credentialSubtitle("gemini", oauthMethod)).toContain("Google OAuth");
  });

  it("mentions the second api key step only when required", () => {
    expect(credentialSubtitle("openai-compatible", { ...baseUrlMethod, requiresApiKey: true })).toContain(
      "then its API key",
    );
    expect(credentialSubtitle("ollama", baseUrlMethod)).not.toContain("then its API key");
  });
});

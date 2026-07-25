import React from "react";
import { describe, expect, it } from "vitest";
import type { AuthMethod } from "@luckycli/core";
import { renderToScreen, scanPositions } from "../../vendor/ink/render-to-screen.js";
import { themeById } from "../themes.js";
import {
  CredentialView,
  SetupInput,
  SetupNavigationHint,
  SetupProgress,
  SetupSection,
} from "./SetupChrome.js";

const theme = themeById(undefined);

const oauthMethod: AuthMethod = { id: "oauth", kind: "oauth", displayName: "OAuth" };
const apiKeyMethod: AuthMethod = { id: "api_key", kind: "apiKey", displayName: "API Key" };
const baseUrlMethod: AuthMethod = { id: "base_url", kind: "baseUrl", displayName: "Base URL" };

describe("SetupProgress", () => {
  it("shows every step on first run and marks earlier ones done", () => {
    const { screen } = renderToScreen(
      <SetupProgress step="credential" theme={theme} mode="initial" />,
      100,
    );
    for (const label of ["Theme", "Provider", "Login", "Connect", "Model"]) {
      expect(scanPositions(screen, label).length).toBeGreaterThan(0);
    }
    // Three completed steps precede "Connect".
    expect(scanPositions(screen, "✓")).toHaveLength(3);
    expect(scanPositions(screen, "●")).toHaveLength(1);
  });

  it("hides the theme step when only switching provider", () => {
    const { screen } = renderToScreen(
      <SetupProgress step="provider" theme={theme} mode="provider" />,
      100,
    );
    expect(scanPositions(screen, "Theme")).toHaveLength(0);
    expect(scanPositions(screen, "Provider").length).toBeGreaterThan(0);
  });
});

describe("SetupSection", () => {
  it("renders the title, subtitle and children", () => {
    const { screen } = renderToScreen(
      <SetupSection title="Choose model" subtitle="pick one" theme={theme}>
        <SetupNavigationHint theme={theme} />
      </SetupSection>,
      80,
    );
    expect(scanPositions(screen, "Choose model").length).toBeGreaterThan(0);
    expect(scanPositions(screen, "pick one").length).toBeGreaterThan(0);
    expect(scanPositions(screen, "enter select").length).toBeGreaterThan(0);
  });
});

describe("SetupInput", () => {
  it("masks the value when asked", () => {
    const { screen } = renderToScreen(
      <SetupInput
        label="API Key"
        value="secret"
        onChange={() => {}}
        onSubmit={() => {}}
        theme={theme}
        mask="*"
      />,
      80,
    );
    expect(scanPositions(screen, "secret")).toHaveLength(0);
    expect(scanPositions(screen, "API Key").length).toBeGreaterThan(0);
  });

  it("shows the raw value with no mask", () => {
    const { screen } = renderToScreen(
      <SetupInput
        label="Base URL"
        value="http://localhost:8080"
        onChange={() => {}}
        onSubmit={() => {}}
        theme={theme}
      />,
      80,
    );
    expect(scanPositions(screen, "http://localhost:8080").length).toBeGreaterThan(0);
  });
});

function credentialView(props: Partial<React.ComponentProps<typeof CredentialView>> = {}) {
  return renderToScreen(
    <CredentialView
      provider="gemini"
      authMethod={apiKeyMethod}
      subStep="input"
      secret=""
      setSecret={() => {}}
      onSubmitSecret={() => {}}
      apiKeySecret=""
      setApiKeySecret={() => {}}
      onSubmitApiKey={() => {}}
      contextWindow=""
      setContextWindow={() => {}}
      onSubmitContext={() => {}}
      contextDiscovering={false}
      projectId=""
      setProjectId={() => {}}
      onSubmitProject={() => {}}
      region=""
      setRegion={() => {}}
      onSubmitRegion={() => {}}
      oauthLoading={false}
      oauthUrl={null}
      oauthError={null}
      theme={theme}
      {...props}
    />,
    100,
  );
}

describe("CredentialView", () => {
  it("shows the authorization url for browser-redirect providers", () => {
    const { screen } = credentialView({
      provider: "gemini",
      authMethod: oauthMethod,
      subStep: "oauth_code",
      oauthUrl: "https://accounts.google.com/authorize",
    });
    expect(scanPositions(screen, "https://accounts.google.com/authorize").length).toBeGreaterThan(0);
  });

  it("tells claude users the browser already opened, with no url to copy", () => {
    const { screen } = credentialView({
      provider: "claude",
      authMethod: oauthMethod,
      subStep: "oauth_code",
    });
    expect(scanPositions(screen, "claude.com").length).toBeGreaterThan(0);
    expect(scanPositions(screen, "authorization URL")).toHaveLength(0);
  });

  it("surfaces an oauth error", () => {
    const { screen } = credentialView({
      authMethod: oauthMethod,
      subStep: "oauth_code",
      oauthError: "Authentication failed: browser closed",
    });
    expect(scanPositions(screen, "browser closed").length).toBeGreaterThan(0);
  });

  it("says the context window is required for openai-compatible, optional elsewhere", () => {
    const required = credentialView({
      provider: "openai-compatible",
      authMethod: baseUrlMethod,
      subStep: "context",
    });
    expect(scanPositions(required.screen, "auto-compaction").length).toBeGreaterThan(0);

    const optional = credentialView({
      provider: "llamacpp",
      authMethod: baseUrlMethod,
      subStep: "context",
    });
    expect(scanPositions(optional.screen, "optional").length).toBeGreaterThan(0);
  });

  it("notes an in-flight context-window probe", () => {
    const { screen } = credentialView({
      provider: "llamacpp",
      authMethod: baseUrlMethod,
      subStep: "context",
      contextDiscovering: true,
    });
    expect(scanPositions(screen, "detecting from server").length).toBeGreaterThan(0);
  });

  it("collects the GCP project then region for vertex", () => {
    const project = credentialView({ subStep: "project" });
    expect(scanPositions(project.screen, "GCP Project ID").length).toBeGreaterThan(0);

    const region = credentialView({ subStep: "region", region: "us-central1" });
    expect(scanPositions(region.screen, "GCP Region").length).toBeGreaterThan(0);
    expect(scanPositions(region.screen, "us-central1").length).toBeGreaterThan(0);
  });

  it("labels the default input by auth kind and masks only api keys", () => {
    const key = credentialView({ authMethod: apiKeyMethod, secret: "sk-visible" });
    expect(scanPositions(key.screen, "API Key").length).toBeGreaterThan(0);
    expect(scanPositions(key.screen, "sk-visible")).toHaveLength(0);

    const url = credentialView({ authMethod: baseUrlMethod, secret: "http://host" });
    expect(scanPositions(url.screen, "Base URL").length).toBeGreaterThan(0);
    expect(scanPositions(url.screen, "http://host").length).toBeGreaterThan(0);
  });
});

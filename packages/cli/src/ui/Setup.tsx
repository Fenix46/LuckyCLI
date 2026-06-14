import { Box, Text, useInput } from "../vendor/ink-compat.js";
import { SelectList } from "./components/SelectList.js";
import { TextField } from "./components/TextField.js";
import React, { useEffect, useRef, useState } from "react";
import {
  PROVIDER_CATALOG,
  fetchLlamaCppContextWindow,
  fetchVllmContextWindow,
  isBaseUrlProvider,
  listProviders,
  loadStoredConfig,
  openBrowser,
  runClaudeBrowserOAuthFlow,
  runOpenAiBrowserOAuthFlow,
  saveStoredConfig,
  startAntigravityOAuthFlow,
  startOAuthFlow,
  type AuthMethod,
  type ClaudeOAuthTokens,
  type OpenAiOAuthTokens,
  type ProviderCredentials,
  type ProviderId,
} from "@luckycli/core";
import { THEMES, themeById, type Theme } from "./themes.js";

export interface SetupResult {
  provider: ProviderId;
  model: string;
  credentials: ProviderCredentials;
}

interface SetupProps {
  onComplete: (result: SetupResult) => void;
  onCancel?: () => void;
  mode?: "initial" | "provider";
}

type Step = "theme" | "provider" | "auth" | "credential" | "model";
type CredentialSubStep =
  | "input"
  | "api_key"
  | "context"
  | "oauth_code"
  | "project"
  | "region";

export function Setup({
  onComplete,
  onCancel,
  mode = "initial",
}: SetupProps): React.JSX.Element {
  const [step, setStep] = useState<Step>(mode === "initial" ? "theme" : "provider");
  const [theme, setTheme] = useState<Theme>(() => themeById(loadStoredConfig().theme));
  const [selectedProviderId, setSelectedProviderId] = useState<ProviderId | null>(null);
  const [savedCredentials, setSavedCredentials] = useState<ProviderCredentials | null>(null);
  const [useSavedCredentials, setUseSavedCredentials] = useState(false);
  const [selectedAuthMethod, setSelectedAuthMethod] = useState<AuthMethod | null>(null);
  const [credSubStep, setCredSubStep] = useState<CredentialSubStep>("input");
  const [secret, setSecret] = useState("");
  // Second secret for baseUrl providers that also need an API key (the custom
  // OpenAI-compatible one): `secret` holds the base URL, this holds the key.
  const [apiKeySecret, setApiKeySecret] = useState("");
  // Context window (tokens) for local providers. Empty = let the agent learn it
  // from observed usage. May be auto-prefilled from the server when reachable.
  const [contextWindow, setContextWindow] = useState("");
  const [contextDiscovering, setContextDiscovering] = useState(false);
  const [gcpProjectId, setGcpProjectId] = useState("");
  const [gcpRegion, setGcpRegion] = useState("us-central1");
  const [oauthUrl, setOauthUrl] = useState<string | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [googleOAuthTokens, setGoogleOAuthTokens] = useState<{ accessToken: string; refreshToken?: string; expiresAt?: number } | null>(null);
  const [antigravityOAuthTokens, setAntigravityOAuthTokens] = useState<{ accessToken: string; refreshToken?: string; expiresAt?: number } | null>(null);
  const [claudeOAuthTokens, setClaudeOAuthTokens] = useState<ClaudeOAuthTokens | null>(null);
  const [openAiOAuthTokens, setOpenAiOAuthTokens] = useState<OpenAiOAuthTokens | null>(null);
  const claudeOAuthStartedRef = useRef(false);
  const googleOAuthStartedRef = useRef(false);
  const antigravityOAuthStartedRef = useRef(false);
  const openAiOAuthStartedRef = useRef(false);

  useInput((_input, key) => {
    if (!key.escape) return;
    goBack();
  });

  useEffect(() => {
    let activeSession: { stop: () => void } | null = null;
    if (
      selectedAuthMethod?.kind !== "oauth" ||
      step !== "credential" ||
      claudeOAuthStartedRef.current ||
      googleOAuthStartedRef.current ||
      antigravityOAuthStartedRef.current ||
      openAiOAuthStartedRef.current
    ) {
      return;
    }

    setOauthLoading(true);
    setOauthError(null);

    if (selectedProviderId === "openai-oauth") {
      openAiOAuthStartedRef.current = true;
      runOpenAiBrowserOAuthFlow()
        .then(({ tokens }) => {
          setOpenAiOAuthTokens(tokens);
          setStep("model");
          setOauthLoading(false);
        })
        .catch((err) => {
          setOauthLoading(false);
          setOauthError(`Authentication failed: ${err instanceof Error ? err.message : String(err)}`);
          openAiOAuthStartedRef.current = false;
        });
      return;
    }

    if (selectedProviderId === "claude") {
      claudeOAuthStartedRef.current = true;
      runClaudeBrowserOAuthFlow()
        .then(({ tokens }) => {
          setClaudeOAuthTokens(tokens);
          setStep("model");
          setOauthLoading(false);
        })
        .catch((err) => {
          setOauthLoading(false);
          setOauthError(`Authentication failed: ${err instanceof Error ? err.message : String(err)}`);
          claudeOAuthStartedRef.current = false;
        });
      return;
    }

    if (selectedProviderId === "antigravity") {
      antigravityOAuthStartedRef.current = true;
      startAntigravityOAuthFlow()
        .then((session) => {
          activeSession = session;
          setOauthUrl(session.url);
          setOauthLoading(false);
          openBrowser(session.url);
          return session.tokenPromise;
        })
        .then((tokens) => {
          if (!tokens.accessToken) throw new Error("Google did not return an access token.");
          if (!tokens.refreshToken) {
            throw new Error("Google did not return a refresh token. Re-consent is required.");
          }
          setAntigravityOAuthTokens(tokens);
          setStep("model");
        })
        .catch((err) => {
          setOauthLoading(false);
          setOauthError(`Authentication failed: ${err instanceof Error ? err.message : String(err)}`);
          antigravityOAuthStartedRef.current = false;
        });
      return () => {
        activeSession?.stop();
      };
    }

    googleOAuthStartedRef.current = true;
    startOAuthFlow()
      .then((session) => {
        activeSession = session;
        setOauthUrl(session.url);
        setOauthLoading(false);
        openBrowser(session.url);
        return session.tokenPromise;
      })
      .then((tokens) => {
        if (!tokens.accessToken) throw new Error("Google did not return an access token.");
        setGoogleOAuthTokens(tokens);
        setStep("model");
      })
      .catch((err) => {
        setOauthLoading(false);
        setOauthError(`Authentication failed: ${err instanceof Error ? err.message : String(err)}`);
        googleOAuthStartedRef.current = false;
      });

    return () => {
      activeSession?.stop();
    };
  }, [selectedAuthMethod?.id, selectedProviderId, step]);

  function onSelectTheme(item: { value: string }) {
    const selected = themeById(item.value);
    setTheme(selected);
    const cfg = loadStoredConfig();
    saveStoredConfig({ ...cfg, theme: selected.id });
    setStep("provider");
  }

  function onSelectProvider(item: { value: ProviderId }) {
    const provider = PROVIDER_CATALOG[item.value];
    setSelectedProviderId(provider.id);
    setSelectedAuthMethod(null);
    resetAuthState();

    const stored = loadStoredConfig();
    const existingCreds = stored.credentials?.[provider.id];
    if (existingCreds) {
      setSavedCredentials(existingCreds);
    } else {
      setSavedCredentials(null);
    }
    setUseSavedCredentials(false);

    setStep("auth");
  }

  function goBack() {
    if (step === "theme") {
      onCancel?.();
      return;
    }

    if (step === "provider") {
      if (mode === "initial") setStep("theme");
      else onCancel?.();
      return;
    }

    if (step === "auth") {
      setSelectedAuthMethod(null);
      resetAuthState();
      setStep("provider");
      return;
    }

    if (step === "credential") {
      if (credSubStep === "region") {
        setCredSubStep("project");
        return;
      }
      if (credSubStep === "api_key") {
        setCredSubStep("input");
        return;
      }
      if (credSubStep === "context") {
        setCredSubStep(selectedAuthMethod?.requiresApiKey ? "api_key" : "input");
        return;
      }
      setSelectedAuthMethod(null);
      resetAuthState();
      setStep("auth");
      return;
    }

    setStep("credential");
  }

  type AuthChoice =
    | { kind: "saved"; credentials: ProviderCredentials }
    | { kind: "new"; method: AuthMethod };

  function onSelectAuthChoice(item: { value: AuthChoice }) {
    if (item.value.kind === "saved") {
      setUseSavedCredentials(true);
      setStep("model");
      return;
    }

    setUseSavedCredentials(false);
    const method = item.value.method;
    setSelectedAuthMethod(method);
    setSecret(method.kind === "baseUrl" ? (method.defaultBaseUrl ?? "") : "");
    setApiKeySecret("");
    setContextWindow("");
    resetAuthState();
    setStep("credential");

    if (method.kind === "oauth") setCredSubStep("oauth_code");
    else if (method.kind === "vertex") setCredSubStep("project");
    else setCredSubStep("input");
  }

  function resetAuthState() {
    setOauthUrl(null);
    setOauthError(null);
    setGoogleOAuthTokens(null);
    setAntigravityOAuthTokens(null);
    setClaudeOAuthTokens(null);
    setOpenAiOAuthTokens(null);
    claudeOAuthStartedRef.current = false;
    googleOAuthStartedRef.current = false;
    antigravityOAuthStartedRef.current = false;
    openAiOAuthStartedRef.current = false;
  }

  function onSubmitSecret() {
    if (!secret.trim()) return;
    // baseUrl providers that also need a key collect it on a second step.
    if (selectedAuthMethod?.kind === "baseUrl" && selectedAuthMethod.requiresApiKey) {
      setCredSubStep("api_key");
      return;
    }
    if (selectedAuthMethod?.kind === "baseUrl") {
      enterContextStep();
      return;
    }
    setStep("model");
  }

  function onSubmitApiKey() {
    if (!apiKeySecret.trim()) return;
    enterContextStep();
  }

  function onSubmitContext() {
    setStep("model");
  }

  // Move to the context-window step, auto-discovering a value to prefill from
  // the server when the provider exposes an endpoint for it (llama.cpp, vLLM).
  function enterContextStep() {
    setCredSubStep("context");
    if (!selectedProviderId) return;
    const url = secret.trim();
    const key = apiKeySecret.trim() || undefined;
    const discover =
      selectedProviderId === "llamacpp"
        ? () => fetchLlamaCppContextWindow(url)
        : selectedProviderId === "vllm"
          ? () => fetchVllmContextWindow(url, key)
          : null;
    if (!discover) return;
    setContextDiscovering(true);
    void discover()
      .then((n) => {
        if (n && n > 0) setContextWindow(String(n));
      })
      .catch(() => {})
      .finally(() => setContextDiscovering(false));
  }

  function onSubmitProject() {
    if (!gcpProjectId.trim()) return;
    setCredSubStep("region");
  }

  function onSubmitRegion() {
    setStep("model");
  }

  function onSelectModel(item: { value: string }) {
    if (!selectedProviderId) return;
    if (useSavedCredentials && savedCredentials) {
      onComplete({ provider: selectedProviderId, model: item.value, credentials: savedCredentials });
      return;
    }
    if (!selectedAuthMethod) return;
    const credentials = buildCredentials(selectedProviderId, selectedAuthMethod);
    if (!credentials) return;
    onComplete({ provider: selectedProviderId, model: item.value, credentials });
  }

  function buildCredentials(
    provider: ProviderId,
    authMethod: AuthMethod,
  ): ProviderCredentials | undefined {
    // Optional context-window override, shared by all base-url providers.
    const ctxField = (): { contextWindow?: number } => {
      const n = Number(contextWindow.trim());
      return contextWindow.trim() && Number.isFinite(n) && n > 0
        ? { contextWindow: n }
        : {};
    };

    if (provider === "claude") {
      if (authMethod.kind === "oauth") {
        if (!claudeOAuthTokens?.accessToken) return incompleteOAuth();
        return { type: "claude", authMethod: "oauth", ...claudeOAuthTokens };
      }
      return { type: "claude", authMethod: "api_key", apiKey: secret.trim() };
    }

    if (provider === "openai") {
      return { type: "openai", apiKey: secret.trim() };
    }

    if (provider === "openai-oauth") {
      if (!openAiOAuthTokens) return incompleteOAuth();
      return { type: "openai-oauth", ...openAiOAuthTokens };
    }

    if (provider === "antigravity") {
      if (!antigravityOAuthTokens?.accessToken || !antigravityOAuthTokens.refreshToken) {
        return incompleteOAuth();
      }
      return {
        type: "antigravity",
        authMethod: "oauth",
        accessToken: antigravityOAuthTokens.accessToken,
        refreshToken: antigravityOAuthTokens.refreshToken,
        ...(antigravityOAuthTokens.expiresAt ? { expiresAt: antigravityOAuthTokens.expiresAt } : {}),
      };
    }

    if (provider === "ollama") {
      return { type: "ollama", baseUrl: secret.trim(), ...ctxField() };
    }

    if (provider === "llamacpp") {
      return {
        type: "llamacpp",
        baseUrl: secret.trim(),
        ...(apiKeySecret.trim() ? { apiKey: apiKeySecret.trim() } : {}),
        ...ctxField(),
      };
    }

    if (provider === "vllm") {
      return {
        type: "vllm",
        baseUrl: secret.trim(),
        ...(apiKeySecret.trim() ? { apiKey: apiKeySecret.trim() } : {}),
        ...ctxField(),
      };
    }

    if (provider === "openai-compatible") {
      return {
        type: "openai-compatible",
        baseUrl: secret.trim(),
        apiKey: apiKeySecret.trim(),
        ...ctxField(),
      };
    }

    if (authMethod.kind === "oauth") {
      if (!googleOAuthTokens?.accessToken) return incompleteOAuth();
      return {
        type: "gemini",
        authMethod: "oauth",
        accessToken: googleOAuthTokens.accessToken,
        ...(googleOAuthTokens.refreshToken ? { refreshToken: googleOAuthTokens.refreshToken } : {}),
        ...(googleOAuthTokens.expiresAt ? { expiresAt: googleOAuthTokens.expiresAt } : {}),
      };
    }

    if (authMethod.kind === "vertex") {
      return {
        type: "gemini",
        authMethod: "vertex",
        projectId: gcpProjectId.trim(),
        ...(gcpRegion.trim() ? { location: gcpRegion.trim() } : {}),
      };
    }

    return { type: "gemini", authMethod: "api_key", apiKey: secret.trim() };
  }

  function incompleteOAuth(): undefined {
    setOauthError("Authentication is incomplete. Please restart setup and try again.");
    setStep("credential");
    setCredSubStep("oauth_code");
    return undefined;
  }

  const catalogEntry = selectedProviderId ? PROVIDER_CATALOG[selectedProviderId] : null;
  const providerName = catalogEntry?.displayName ?? "Provider";

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} width="100%">
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.muted}
        paddingX={2}
        paddingY={1}
        width="100%"
      >
        <Box flexDirection="row" marginBottom={1}>
          <Text bold color={theme.accent}>▌ </Text>
          <Text bold color={theme.primary}>
            {mode === "initial" ? "LuckyCLI setup" : "Provider setup"}
          </Text>
          <Text color={theme.muted}>
            {mode === "initial" ? " · first run" : " · switch provider"}
          </Text>
        </Box>

        <SetupProgress step={step} theme={theme} mode={mode} />

        <Box flexDirection="column" marginTop={1}>
          {step === "theme" && (
            <SetupSection
              title="Choose theme"
              subtitle="Pick the terminal palette before configuring the agent."
              theme={theme}
            >
              <SelectList
                items={THEMES.map((candidate) => ({
                  key: candidate.id,
                  label: `${candidate.name} (${candidate.id})`,
                  value: candidate.id,
                }))}
                onSelect={onSelectTheme}
                theme={theme}
              />
              <SetupNavigationHint theme={theme} />
            </SetupSection>
          )}

          {step === "provider" && (
            <SetupSection
              title="Choose provider"
              subtitle="Select the account or local runtime LuckyCLI should use."
              theme={theme}
            >
              <SelectList
                items={listProviders().map((provider) => {
                  const stored = loadStoredConfig();
                  const isSaved = !!stored.credentials?.[provider.id];
                  return {
                    key: provider.id,
                    label: `${providerLabel(provider.id)}${isSaved ? " (Logged in)" : ""}`,
                    value: provider.id,
                  };
                })}
                onSelect={onSelectProvider}
                theme={theme}
              />
              <SetupNavigationHint
                theme={theme}
                escapeLabel={mode === "initial" ? "go back" : "cancel"}
              />
            </SetupSection>
          )}

          {step === "auth" && selectedProviderId && (
            <SetupSection
              title="Login"
              subtitle={`Choose how to authenticate with ${providerName}.`}
              theme={theme}
            >
              <SelectList
                items={[
                  ...(savedCredentials
                    ? [
                        {
                          label: `Use saved credentials (${savedCredentialsLabel(savedCredentials)})`,
                          value: { kind: "saved" as const, credentials: savedCredentials },
                        },
                      ]
                    : []),
                  ...PROVIDER_CATALOG[selectedProviderId].authMethods.map((method) => ({
                    label: method.displayName,
                    value: { kind: "new" as const, method },
                  })),
                ]}
                onSelect={onSelectAuthChoice}
                theme={theme}
              />
              <SetupNavigationHint theme={theme} />
            </SetupSection>
          )}

          {step === "credential" && selectedAuthMethod && (
            <SetupSection
              title="Connect account"
              subtitle={credentialSubtitle(selectedProviderId, selectedAuthMethod)}
              theme={theme}
            >
              <CredentialView
                provider={selectedProviderId}
                authMethod={selectedAuthMethod}
                subStep={credSubStep}
                secret={secret}
                setSecret={setSecret}
                onSubmitSecret={onSubmitSecret}
                apiKeySecret={apiKeySecret}
                setApiKeySecret={setApiKeySecret}
                onSubmitApiKey={onSubmitApiKey}
                contextWindow={contextWindow}
                setContextWindow={setContextWindow}
                onSubmitContext={onSubmitContext}
                contextDiscovering={contextDiscovering}
                projectId={gcpProjectId}
                setProjectId={setGcpProjectId}
                onSubmitProject={onSubmitProject}
                region={gcpRegion}
                setRegion={setGcpRegion}
                onSubmitRegion={onSubmitRegion}
                oauthLoading={oauthLoading}
                oauthUrl={oauthUrl}
                oauthError={oauthError}
                theme={theme}
              />
            </SetupSection>
          )}

          {step === "model" && catalogEntry && (
            <SetupSection
              title="Choose model"
              subtitle="Select the default model. You can switch later with /model."
              theme={theme}
            >
              <SelectList
                items={catalogEntry.availableModels.map((model) => ({
                  key: model,
                  label: model,
                  value: model,
                }))}
                onSelect={onSelectModel}
                theme={theme}
              />
              <SetupNavigationHint theme={theme} selectLabel="save" />
            </SetupSection>
          )}
        </Box>
      </Box>
    </Box>
  );
}

function SetupProgress({
  step,
  theme,
  mode,
}: {
  step: Step;
  theme: Theme;
  mode: "initial" | "provider";
}): React.JSX.Element {
  const allSteps: Array<{ key: Step; label: string }> = [
    { key: "theme", label: "Theme" },
    { key: "provider", label: "Provider" },
    { key: "auth", label: "Login" },
    { key: "credential", label: "Connect" },
    { key: "model", label: "Model" },
  ];
  const steps = allSteps.filter((item) => mode === "initial" || item.key !== "theme");
  const current = steps.findIndex((item) => item.key === step);
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        {steps.map((item, index) => (
          <Text
            key={item.key}
            bold={index === current}
            color={index === current ? theme.accent : index < current ? theme.success : theme.muted}
          >
            {index < current ? "✓" : index === current ? "●" : "○"} {item.label}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color={theme.accent}>{"█".repeat((current + 1) * 6)}</Text>
        <Text color={theme.muted}>{"░".repeat((steps.length - current - 1) * 6)}</Text>
      </Box>
    </Box>
  );
}

function SetupSection({
  title,
  subtitle,
  theme,
  children,
}: {
  title: string;
  subtitle: string;
  theme: Theme;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Text bold color={theme.primary}>{title}</Text>
      <Text color={theme.muted}>{subtitle}</Text>
      <Box flexDirection="column" marginTop={1}>{children}</Box>
    </Box>
  );
}

function CredentialView({
  provider,
  authMethod,
  subStep,
  secret,
  setSecret,
  onSubmitSecret,
  apiKeySecret,
  setApiKeySecret,
  onSubmitApiKey,
  contextWindow,
  setContextWindow,
  onSubmitContext,
  contextDiscovering,
  projectId,
  setProjectId,
  onSubmitProject,
  region,
  setRegion,
  onSubmitRegion,
  oauthLoading,
  oauthUrl,
  oauthError,
  theme,
}: {
  provider: ProviderId | null;
  authMethod: AuthMethod;
  subStep: CredentialSubStep;
  secret: string;
  setSecret: (value: string) => void;
  onSubmitSecret: () => void;
  apiKeySecret: string;
  setApiKeySecret: (value: string) => void;
  onSubmitApiKey: () => void;
  contextWindow: string;
  setContextWindow: (value: string) => void;
  onSubmitContext: () => void;
  contextDiscovering: boolean;
  projectId: string;
  setProjectId: (value: string) => void;
  onSubmitProject: () => void;
  region: string;
  setRegion: (value: string) => void;
  onSubmitRegion: () => void;
  oauthLoading: boolean;
  oauthUrl: string | null;
  oauthError: string | null;
  theme: Theme;
}): React.JSX.Element {
  if (subStep === "oauth_code") {
    return (
      <Box flexDirection="column">
        {oauthLoading ? (
          <Text color={theme.warning}>Starting secure browser login...</Text>
        ) : (
          <>
            {provider === "openai-oauth" || provider === "claude" ? (
              <Text color={theme.muted}>
                Browser opened on {provider === "claude" ? "claude.com" : "auth.openai.com"}. Complete login there.
              </Text>
            ) : (
              <>
                <Text color={theme.muted}>Open the authorization URL in your browser:</Text>
                <Text bold underline color={theme.accent}>{oauthUrl || "Generating authorization link..."}</Text>
              </>
            )}
            <Box marginTop={1}>
              <Text color={theme.warning}>Waiting for browser callback...</Text>
            </Box>
          </>
        )}
        {oauthError ? (
          <Box marginTop={1}>
            <Text color={theme.error}>{oauthError}</Text>
          </Box>
        ) : null}
        <Box marginTop={1}>
          <Text color={theme.muted}>Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  if (subStep === "api_key") {
    return (
      <SetupInput
        label="API Key"
        value={apiKeySecret}
        onChange={setApiKeySecret}
        onSubmit={onSubmitApiKey}
        theme={theme}
        hint="API key for your server"
        mask="*"
      />
    );
  }

  if (subStep === "context") {
    const hint = contextDiscovering
      ? "detecting from server..."
      : provider === "openai-compatible"
        ? "tokens — set this so context tracking & auto-compaction work"
        : "tokens — optional; Enter to skip (learned from usage)";
    return (
      <SetupInput
        label="Context window"
        value={contextWindow}
        onChange={setContextWindow}
        onSubmit={onSubmitContext}
        theme={theme}
        hint={hint}
      />
    );
  }

  if (subStep === "project") {
    return (
      <SetupInput
        label="GCP Project ID"
        value={projectId}
        onChange={setProjectId}
        onSubmit={onSubmitProject}
        theme={theme}
      />
    );
  }

  if (subStep === "region") {
    return (
      <SetupInput
        label="GCP Region"
        value={region}
        onChange={setRegion}
        onSubmit={onSubmitRegion}
        theme={theme}
        hint="default: us-central1"
      />
    );
  }

  return (
    <SetupInput
      label={authMethod.kind === "apiKey" ? "API Key" : "Base URL"}
      value={secret}
      onChange={setSecret}
      onSubmit={onSubmitSecret}
      theme={theme}
      hint={authMethod.hint}
      mask={authMethod.kind === "apiKey" ? "*" : undefined}
    />
  );
}

function SetupInput({
  label,
  value,
  onChange,
  onSubmit,
  theme,
  hint,
  mask,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  theme: Theme;
  hint?: string;
  mask?: string;
}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text bold color={theme.accent}>{label}: </Text>
        <TextField value={value} onChange={onChange} onSubmit={onSubmit} {...(mask ? { mask } : {})} />
      </Box>
      <Box marginTop={1}>
        <Text color={theme.muted} dimColor>
          {hint ? `${hint} · ` : ""}enter continue · esc go back
        </Text>
      </Box>
    </Box>
  );
}

function SetupNavigationHint({
  theme,
  selectLabel = "select",
  escapeLabel = "go back",
}: {
  theme: Theme;
  selectLabel?: string;
  escapeLabel?: string;
}): React.JSX.Element {
  return (
    <Box marginTop={1}>
      <Text color={theme.muted} dimColor>↑↓ move · enter {selectLabel} · esc {escapeLabel}</Text>
    </Box>
  );
}

function providerLabel(provider: ProviderId): string {
  if (provider === "openai-oauth") return "ChatGPT Plus/Pro";
  if (provider === "antigravity") return "Google Antigravity";
  const entry = PROVIDER_CATALOG[provider];
  if (entry.company === "Google") return "Google Gemini";
  return entry.displayName;
}

function savedCredentialsLabel(creds: ProviderCredentials): string {
  switch (creds.type) {
    case "claude":
      if (creds.authMethod === "oauth") {
        return creds.email ? `OAuth: ${creds.email}` : "OAuth Session";
      }
      return creds.apiKey ? `API Key: ${creds.apiKey.slice(0, 4)}...${creds.apiKey.slice(-4)}` : "API Key";
    case "openai":
      return creds.apiKey ? `API Key: ${creds.apiKey.slice(0, 4)}...${creds.apiKey.slice(-4)}` : "API Key";
    case "openai-oauth":
      return "ChatGPT Account";
    case "gemini":
      if (creds.authMethod === "vertex") {
        return `Vertex AI: ${creds.projectId ?? ""}`;
      }
      if (creds.authMethod === "oauth") {
        return "Google OAuth Session";
      }
      return creds.apiKey ? `API Key: ${creds.apiKey.slice(0, 4)}...${creds.apiKey.slice(-4)}` : "API Key";
    case "antigravity":
      return "Google Antigravity Session";
    case "ollama":
    case "llamacpp":
    case "vllm":
    case "openai-compatible":
      return `Local URL: ${creds.baseUrl}`;
    default:
      return "Saved Credentials";
  }
}

function credentialSubtitle(provider: ProviderId | null, authMethod: AuthMethod): string {
  if (authMethod.kind === "oauth") {
    if (provider === "claude") return "A browser window will open for Claude subscription login.";
    if (provider === "openai-oauth") return "A browser window will open for ChatGPT account login.";
    if (provider === "antigravity") return "A browser window will open for Google Antigravity login.";
    return "A browser window will open for Google OAuth login.";
  }
  if (authMethod.kind === "vertex") return "Use your Google Cloud project and region.";
  if (authMethod.kind === "baseUrl") {
    return authMethod.requiresApiKey
      ? "Enter your server's base URL, then its API key. Stored locally in ~/.luckycli/config.json."
      : "Use a local or remote endpoint. Stored locally in ~/.luckycli/config.json.";
  }
  return "Paste the provider API key. It will be stored locally in ~/.luckycli/config.json.";
}

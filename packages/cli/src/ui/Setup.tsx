import { Box, Text, useInput } from "ink";
import { SelectList } from "./components/SelectList.js";
import { TextField } from "./components/TextField.js";
import React, { useEffect, useRef, useState } from "react";
import {
  PROVIDER_CATALOG,
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
type CredentialSubStep = "input" | "oauth_code" | "project" | "region";

export function Setup({
  onComplete,
  onCancel,
  mode = "initial",
}: SetupProps): React.JSX.Element {
  const [step, setStep] = useState<Step>(mode === "initial" ? "theme" : "provider");
  const [theme, setTheme] = useState<Theme>(() => themeById(loadStoredConfig().theme));
  const [selectedProviderId, setSelectedProviderId] = useState<ProviderId | null>(null);
  const [selectedAuthMethod, setSelectedAuthMethod] = useState<AuthMethod | null>(null);
  const [credSubStep, setCredSubStep] = useState<CredentialSubStep>("input");
  const [secret, setSecret] = useState("");
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
      setSelectedAuthMethod(null);
      resetAuthState();
      setStep("auth");
      return;
    }

    setStep("credential");
  }

  function onSelectAuthMethod(item: { value: AuthMethod }) {
    setSelectedAuthMethod(item.value);
    setSecret(item.value.kind === "baseUrl" ? "http://localhost:11434" : "");
    resetAuthState();
    setStep("credential");

    if (item.value.kind === "oauth") setCredSubStep("oauth_code");
    else if (item.value.kind === "vertex") setCredSubStep("project");
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
    setStep("model");
  }

  function onSubmitProject() {
    if (!gcpProjectId.trim()) return;
    setCredSubStep("region");
  }

  function onSubmitRegion() {
    setStep("model");
  }

  function onSelectModel(item: { value: string }) {
    if (!selectedProviderId || !selectedAuthMethod) return;
    const credentials = buildCredentials(selectedProviderId, selectedAuthMethod);
    if (!credentials) return;
    onComplete({ provider: selectedProviderId, model: item.value, credentials });
  }

  function buildCredentials(
    provider: ProviderId,
    authMethod: AuthMethod,
  ): ProviderCredentials | undefined {
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
      return { type: "ollama", baseUrl: secret.trim() };
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
        borderStyle="single"
        borderColor={theme.muted}
        paddingX={2}
        paddingY={1}
        width="100%"
      >
        <Box flexDirection="row" marginBottom={1}>
          <Text bold color={theme.accent}>›_ </Text>
          <Text bold color={theme.primary}>
            {mode === "initial" ? "LuckyCLI setup" : "Provider setup"}
          </Text>
          <Text color={theme.muted}>
            {mode === "initial" ? "  first run" : "  switch provider"}
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
                items={listProviders().map((provider) => ({
                  key: provider.id,
                  label: providerLabel(provider.id),
                  value: provider.id,
                }))}
                onSelect={onSelectProvider}
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
                items={PROVIDER_CATALOG[selectedProviderId].authMethods.map((method) => ({
                  key: method.id,
                  label: method.displayName,
                  value: method,
                }))}
                onSelect={onSelectAuthMethod}
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
      <Box marginTop={0.5}>
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
        <Text color={theme.muted}>
          {hint ? `${hint} · ` : ""}Enter to continue · Esc to go back
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
      <Text color={theme.muted}>Up/Down to move · Enter to {selectLabel} · Esc to {escapeLabel}</Text>
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

function credentialSubtitle(provider: ProviderId | null, authMethod: AuthMethod): string {
  if (authMethod.kind === "oauth") {
    if (provider === "claude") return "A browser window will open for Claude subscription login.";
    if (provider === "openai-oauth") return "A browser window will open for ChatGPT account login.";
    if (provider === "antigravity") return "A browser window will open for Google Antigravity login.";
    return "A browser window will open for Google OAuth login.";
  }
  if (authMethod.kind === "vertex") return "Use your Google Cloud project and region.";
  if (authMethod.kind === "baseUrl") return "Use a local or remote Ollama endpoint.";
  return "Paste the provider API key. It will be stored locally in ~/.luckycli/config.json.";
}

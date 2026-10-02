import { Box, Text, useInput } from "../vendor/ink-compat.js";
import { SelectList } from "./components/SelectList.js";
import { TextField } from "./components/TextField.js";
import React, { useState } from "react";
import {
  PROVIDER_CATALOG,
  listProviders,
  loadStoredConfig,
  saveStoredConfig,
  type AuthMethod,
  type ProviderCredentials,
  type ProviderId,
} from "@luckycli/core";
import { THEMES, themeById, type Theme } from "./themes.js";
import {
  buildCredentials,
  credentialSubtitle,
  providerLabel,
  savedCredentialsLabel,
  type SetupFormState,
} from "./lib/setup-credentials.js";
import {
  selectContextWindowDiscovery,
  selectModelDiscovery,
  toModelDiscoveryOutcome,
} from "./lib/setup-discovery.js";
import { useSetupOAuth } from "./hooks/useSetupOAuth.js";
import {
  CredentialView,
  SetupInput,
  SetupNavigationHint,
  SetupProgress,
  SetupSection,
} from "./components/SetupChrome.js";
import {
  CUSTOM_MODEL_SENTINEL,
  type CredentialSubStep,
  type Step,
} from "./lib/setup-steps.js";

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
  // Free-text model name for providers with no static catalog (the user types
  // whatever their server loaded). Used by the "model" step's text input.
  const [modelText, setModelText] = useState("");
  // Models discovered from the server's /v1/models (or Ollama /api/tags),
  // proposed in the model step so the user can pick instead of typing.
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  // Context window (tokens) per discovered model id, when the endpoint reports
  // it. Used to persist the selected model's window into credentials so context
  // tracking and auto-compaction work without manual input.
  const [discoveredContextByModel, setDiscoveredContextByModel] = useState<
    Record<string, number>
  >({});
  const [modelsDiscovering, setModelsDiscovering] = useState(false);
  // Force the free-text model input even when discovery proposed a list (the
  // user picked "type a custom name").
  const [forceModelInput, setForceModelInput] = useState(false);
  const [gcpProjectId, setGcpProjectId] = useState("");
  const [gcpRegion, setGcpRegion] = useState("us-central1");
  const oauth = useSetupOAuth({
    provider: selectedProviderId,
    authMethod: selectedAuthMethod,
    active: step === "credential",
    onAuthenticated: () => setStep("model"),
  });

  useInput((_input, key) => {
    if (!key.escape) return;
    goBack();
  });

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
    oauth.reset();

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
      oauth.reset();
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
      oauth.reset();
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
    setModelText("");
    setDiscoveredModels([]);
    setDiscoveredContextByModel({});
    setForceModelInput(false);
    oauth.reset();
    setStep("credential");

    if (method.kind === "oauth") setCredSubStep("oauth_code");
    else if (method.kind === "vertex") setCredSubStep("project");
    else setCredSubStep("input");
  }

  function onSubmitSecret() {
    // Gateways with a free public tier (zen) may proceed with an empty key.
    if (!secret.trim() && !selectedAuthMethod?.optionalApiKey) return;
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
    discoverModels();
  }

  function onSubmitApiKey() {
    if (!apiKeySecret.trim()) return;
    enterContextStep();
  }

  function onSubmitContext() {
    setStep("model");
    discoverModels();
  }

  // Propose the models the endpoint actually serves so the user picks instead
  // of typing.
  function discoverModels() {
    const discover = selectModelDiscovery(selectedProviderId, { secret, apiKeySecret });
    if (!discover) return;
    setModelsDiscovering(true);
    void discover()
      .then((models) => {
        const outcome = toModelDiscoveryOutcome(models);
        setDiscoveredModels(outcome.modelIds);
        setDiscoveredContextByModel(outcome.contextByModel);
        if (outcome.preselectedModel) setModelText(outcome.preselectedModel);
      })
      .catch(() => {})
      .finally(() => setModelsDiscovering(false));
  }

  // Move to the context-window step, auto-discovering a value to prefill from
  // the server when the provider exposes an endpoint for it (llama.cpp, vLLM).
  function enterContextStep() {
    setCredSubStep("context");
    const discover = selectContextWindowDiscovery(selectedProviderId, { secret, apiKeySecret });
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

  function onSubmitModel() {
    const model = modelText.trim();
    if (!model) return;
    onSelectModel({ value: model });
  }

  function onSelectModel(item: { value: string }) {
    if (item.value === CUSTOM_MODEL_SENTINEL) {
      setForceModelInput(true);
      return;
    }
    if (!selectedProviderId) return;
    if (useSavedCredentials && savedCredentials) {
      onComplete({ provider: selectedProviderId, model: item.value, credentials: savedCredentials });
      return;
    }
    if (!selectedAuthMethod) return;
    const credentials = buildCredentials(
      selectedProviderId,
      selectedAuthMethod,
      item.value,
      formState(),
    );
    // `undefined` means an OAuth flow never completed — send the user back
    // instead of saving incomplete credentials.
    if (!credentials) {
      incompleteOAuth();
      return;
    }
    onComplete({ provider: selectedProviderId, model: item.value, credentials });
  }

  /** Snapshot of the collected inputs, as consumed by `buildCredentials`. */
  function formState(): SetupFormState {
    return {
      secret,
      apiKeySecret,
      contextWindow,
      discoveredContextByModel,
      gcpProjectId,
      gcpRegion,
      googleOAuthTokens: oauth.googleOAuthTokens,
      antigravityOAuthTokens: oauth.antigravityOAuthTokens,
      claudeOAuthTokens: oauth.claudeOAuthTokens,
      openAiOAuthTokens: oauth.openAiOAuthTokens,
    };
  }

  function incompleteOAuth(): void {
    oauth.setIncompleteError();
    setStep("credential");
    setCredSubStep("oauth_code");
  }

  const catalogEntry = selectedProviderId ? PROVIDER_CATALOG[selectedProviderId] : null;
  const providerName = catalogEntry?.displayName ?? "Provider";

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} width="100%">
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.subtle}
        paddingX={2}
        paddingY={1}
        width="100%"
      >
        <Box flexDirection="row" marginBottom={1}>
          <Text bold color={theme.primary}>☘ lucky</Text>
          <Text color={theme.muted}>
            {mode === "initial" ? "  ·  let's get you set up" : "  ·  switch provider"}
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
                oauthLoading={oauth.oauthLoading}
                oauthUrl={oauth.oauthUrl}
                oauthError={oauth.oauthError}
                theme={theme}
              />
            </SetupSection>
          )}

          {step === "model" && catalogEntry && catalogEntry.availableModels.length > 0 && (
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

          {step === "model" && catalogEntry && catalogEntry.availableModels.length === 0 && (
            <SetupSection
              title="Model name"
              subtitle={
                discoveredModels.length > 0
                  ? "Pick a model your server serves, or type one. Change it later with /model."
                  : "Type the exact model name your server serves. You can change it later with /model."
              }
              theme={theme}
            >
              {modelsDiscovering ? (
                <Text color={theme.warning}>Detecting models from the server...</Text>
              ) : discoveredModels.length > 0 && !forceModelInput ? (
                <SelectList
                  items={[
                    ...discoveredModels.map((model) => ({
                      key: model,
                      label: model,
                      value: model,
                    })),
                    {
                      key: CUSTOM_MODEL_SENTINEL,
                      label: "✎ Type a custom name…",
                      value: CUSTOM_MODEL_SENTINEL,
                    },
                  ]}
                  onSelect={onSelectModel}
                  theme={theme}
                />
              ) : (
                <SetupInput
                  label="Model"
                  value={modelText}
                  onChange={setModelText}
                  onSubmit={onSubmitModel}
                  theme={theme}
                  hint="e.g. the name from your server's /v1/models"
                />
              )}
              <SetupNavigationHint theme={theme} selectLabel="save" />
            </SetupSection>
          )}
        </Box>
      </Box>
    </Box>
  );
}

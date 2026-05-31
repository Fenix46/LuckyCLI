import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import React, { useState, useEffect, useRef } from "react";
import {
  PROVIDER_CATALOG,
  listProviders,
  runClaudeBrowserOAuthFlow,
  runOpenAiBrowserOAuthFlow,
  startOAuthFlow,
  openBrowser,
  type ClaudeOAuthTokens,
  type OpenAiOAuthTokens,
  type ProviderCredentials,
  type ProviderId,
  type AuthMethod,
} from "@luckycli/core";

export interface SetupResult {
  provider: ProviderId;
  model: string;
  credentials: ProviderCredentials;
}

interface SetupProps {
  onComplete: (result: SetupResult) => void;
}

type Step = "company" | "authMethod" | "credential" | "model";
type CredentialSubStep = "input" | "oauth_code" | "project" | "region";

const WELCOME_LOGO = `
  _      _    _  ____ _  __ __   __ ____ _     ___ 
 | |    | |  | |/ ___| |/ / \\ / // ___| |   |_ _|
 | |    | |  | | |   | ' /   \\ V /| |   | |    | | 
 | |___ | |__| | |___| . \\    | | | |___| |___ | | 
 |_____| \\____/ \\____|_|\\_\\   |_|  \\____|_____|___|
`;

function WizardProgressBar({ currentStep }: { currentStep: Step }): React.JSX.Element {
  const steps = [
    { key: "company", label: "SELECT_PROVIDER" },
    { key: "authMethod", label: "CHOOSE_AUTH" },
    { key: "credential", label: "INPUT_CREDENTIALS" },
    { key: "model", label: "LOCK_MODEL" },
  ] as const;

  const currentIdx = steps.findIndex((x) => x.key === currentStep);

  return (
    <Box flexDirection="column" marginY={1} width="100%">
      <Box flexDirection="row" gap={1} marginBottom={0.5}>
        {steps.map((s, idx) => {
          const isCurrent = s.key === currentStep;
          const isPast = currentIdx > idx;
          const label = `STAGE_0${idx + 1}:${s.label}`;
          const color = isCurrent ? "yellow" : isPast ? "green" : "gray";
          return (
            <Box key={s.key} flexDirection="row">
              <Text bold={isCurrent} color={color}>
                {isCurrent ? `▶ [${label}]` : isPast ? `✔ [${label}]` : `  [${label}]`}
              </Text>
              {idx < steps.length - 1 && (
                <Text color="gray">{" ═ "}</Text>
              )}
            </Box>
          );
        })}
      </Box>
      <Box flexDirection="row" gap={1}>
        <Text color="cyan">DECK SYSTEM STACK INIT: </Text>
        <Text color="green">
          {"█".repeat((currentIdx + 1) * 8)}
          {"░".repeat((4 - (currentIdx + 1)) * 8)}
          {` ${Math.round(((currentIdx + 1) / 4) * 100)}%`}
        </Text>
      </Box>
    </Box>
  );
}

export function Setup({ onComplete }: SetupProps): React.JSX.Element {
  const [step, setStep] = useState<Step>("company");
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<ProviderId | null>(null);
  const [selectedAuthMethod, setSelectedAuthMethod] = useState<AuthMethod | null>(null);

  // Credential Sub-Steps & Inputs
  const [credSubStep, setCredSubStep] = useState<CredentialSubStep>("input");
  const [secret, setSecret] = useState("");
  const [gcpProjectId, setGcpProjectId] = useState("");
  const [gcpRegion, setGcpRegion] = useState("us-central1");

  // OAuth Flow State
  const [oauthUrl, setOauthUrl] = useState<string | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthTokens, setOauthTokens] = useState<{ accessToken: string; refreshToken?: string } | null>(null);
  const [claudeOAuthTokens, setClaudeOAuthTokens] = useState<ClaudeOAuthTokens | null>(null);
  const [openAiOAuthTokens, setOpenAiOAuthTokens] = useState<OpenAiOAuthTokens | null>(null);
  const claudeOAuthStartedRef = useRef(false);
  const googleOAuthStartedRef = useRef(false);
  const openAiOAuthStartedRef = useRef(false);

  // Initialize dynamic Google OAuth loopback flow asynchronously.
  useEffect(() => {
    let activeSession: any = null;
    if (
      selectedAuthMethod?.kind === "oauth" &&
      step === "credential" &&
      !claudeOAuthStartedRef.current &&
      !googleOAuthStartedRef.current &&
      !openAiOAuthStartedRef.current
    ) {
      setOauthLoading(true);
      setOauthError(null);

      if (selectedProviderId === "openai-oauth") {
        if (openAiOAuthStartedRef.current) return;
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
          });
        return;
      }

      if (selectedProviderId === "claude") {
        if (claudeOAuthStartedRef.current) return;
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
          if (!tokens.accessToken) {
            throw new Error("Google did not return an access token.");
          }
          setOauthTokens(tokens);
          setStep("model");
        })
        .catch((err) => {
          setOauthLoading(false);
          setOauthError(`Authentication failed: ${err instanceof Error ? err.message : String(err)}`);
          googleOAuthStartedRef.current = false;
        });
    }

    return () => {
      if (activeSession) {
        activeSession.stop();
      }
    };
  }, [selectedAuthMethod?.id, selectedProviderId, step]);

  const companyItems = listProviders().map((provider) => ({
    key: provider.id,
    label:
      provider.id === "openai-oauth"
        ? "ChatGPT Plus/Pro"
        : provider.company === "Google"
        ? "Google Gemini"
        : provider.displayName,
    value: provider.id,
  }));

  function onSelectCompany(item: { value: ProviderId }) {
    const provider = PROVIDER_CATALOG[item.value];
    setSelectedCompany(provider.displayName);
    setSelectedProviderId(provider.id);
    setStep("authMethod");
    setSelectedAuthMethod(null);
    setOauthUrl(null);
    setOauthError(null);
    setOauthTokens(null);
    setClaudeOAuthTokens(null);
    setOpenAiOAuthTokens(null);
    claudeOAuthStartedRef.current = false;
    googleOAuthStartedRef.current = false;
    openAiOAuthStartedRef.current = false;
  }

  function onSelectAuthMethod(item: { value: AuthMethod }) {
    setSelectedAuthMethod(item.value);
    setSecret(item.value.kind === "baseUrl" ? "http://localhost:11434" : "");
    setOauthUrl(null);
    setOauthError(null);
    setOauthTokens(null);
    setClaudeOAuthTokens(null);
    setOpenAiOAuthTokens(null);
    claudeOAuthStartedRef.current = false;
    googleOAuthStartedRef.current = false;
    openAiOAuthStartedRef.current = false;
    setStep("credential");

    if (item.value.kind === "oauth") {
      setCredSubStep("oauth_code");
    } else if (item.value.kind === "vertex") {
      setCredSubStep("project");
    } else {
      setCredSubStep("input");
    }
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

    let credentials: ProviderCredentials;
    if (selectedProviderId === "claude") {
      if (selectedAuthMethod.kind === "oauth") {
        if (!claudeOAuthTokens?.accessToken) {
          setOauthError("Authentication is incomplete. Please restart setup and try again.");
          setStep("credential");
          setCredSubStep("oauth_code");
          return;
        }
        credentials = { type: "claude", authMethod: "oauth", ...claudeOAuthTokens };
      } else {
        credentials = { type: "claude", authMethod: "api_key", apiKey: secret.trim() };
      }
    } else if (selectedProviderId === "openai") {
      credentials = { type: "openai", apiKey: secret.trim() };
    } else if (selectedProviderId === "openai-oauth") {
      if (!openAiOAuthTokens) {
        setOauthError("Authentication is incomplete. Please restart setup and try again.");
        setStep("credential");
        setCredSubStep("oauth_code");
        return;
      }
      credentials = { type: "openai-oauth", ...openAiOAuthTokens };
    } else if (selectedProviderId === "ollama") {
      credentials = { type: "ollama", baseUrl: secret.trim() };
    } else {
      // Gemini
      if (selectedAuthMethod.kind === "oauth") {
        if (!oauthTokens?.accessToken) {
          setOauthError("Authentication is incomplete. Please restart setup and try again.");
          setStep("credential");
          setCredSubStep("oauth_code");
          return;
        }
        credentials = {
          type: "gemini",
          authMethod: "oauth",
          accessToken: oauthTokens.accessToken,
          refreshToken: oauthTokens?.refreshToken,
        };
      } else if (selectedAuthMethod.kind === "vertex") {
        credentials = {
          type: "gemini",
          authMethod: "vertex",
          projectId: gcpProjectId.trim(),
          location: gcpRegion.trim() || undefined,
        };
      } else {
        credentials = {
          type: "gemini",
          authMethod: "api_key",
          apiKey: secret.trim(),
        };
      }
    }

    onComplete({
      provider: selectedProviderId,
      model: item.value,
      credentials,
    });
  }

  const catalogEntry = selectedProviderId ? PROVIDER_CATALOG[selectedProviderId] : null;

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} width="100%">
      {/* ASCII Splash Logo */}
      <Text bold color="cyan">
        {WELCOME_LOGO}
      </Text>
      <Box marginBottom={1}>
        <Text color="gray">
          ✦ Setup your environment to begin collaborating with the agent.
        </Text>
      </Box>

      {/* Horizontal Step-by-Step Progress Bar */}
      <WizardProgressBar currentStep={step} />

      {/* Main Wizard Area Wrapped in a Card */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderTop={true}
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        borderColor="gray"
        paddingTop={1}
        marginTop={0.5}
        width="100%"
      >
        {step === "company" && (
          <Box flexDirection="column">
            <Text bold color="cyan">🔐 SELECT PROVIDER COMPANY</Text>
            <Text color="gray" dimColor>Select the cloud or local service you want to use:</Text>
            <Box marginTop={1} flexDirection="column">
              <SelectInput
                items={companyItems}
                onSelect={onSelectCompany}
              />
            </Box>
          </Box>
        )}

        {step === "authMethod" && selectedCompany && selectedProviderId && (
          <Box flexDirection="column">
            <Text bold color="cyan">🔑 SELECT LOGIN METHOD</Text>
            <Text color="gray" dimColor>Select how you want to authenticate with {selectedCompany}:</Text>
            <Box marginTop={1} flexDirection="column">
              <SelectInput
                items={PROVIDER_CATALOG[selectedProviderId].authMethods.map((m) => ({
                  key: m.id,
                  label: m.displayName,
                  value: m,
                }))}
                onSelect={onSelectAuthMethod}
              />
            </Box>
          </Box>
        )}

        {step === "credential" && selectedAuthMethod && (
          <Box flexDirection="column">
            <Text bold color="cyan">⚙️ ENTER CREDENTIALS</Text>
            <Text color="gray" dimColor>Provide connection parameters for authentication:</Text>

            {credSubStep === "input" && (
              <Box flexDirection="column" marginTop={1}>
                <Box flexDirection="row">
                  <Text bold color="cyan">
                    {selectedAuthMethod.kind === "apiKey" ? "API Key" : "Base URL"}{" "}
                    <Text color="gray">({selectedAuthMethod.hint})</Text>:{" "}
                  </Text>
                  <TextInput
                    value={secret}
                    onChange={setSecret}
                    onSubmit={onSubmitSecret}
                    {...(selectedAuthMethod.kind === "apiKey" ? { mask: "*" } : {})}
                  />
                </Box>
                <Box marginTop={1} borderStyle="single" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false} borderColor="gray" paddingTop={0.5}>
                  <Text dimColor color="gray">Press [Enter] to submit credentials</Text>
                </Box>
              </Box>
            )}

            {credSubStep === "oauth_code" && (
              <Box flexDirection="column" marginTop={1}>
                {oauthLoading ? (
                  <Text color="yellow">⏳ Starting secure loopback callback server...</Text>
                ) : (
                  <Box flexDirection="column">
                    {selectedProviderId === "openai-oauth" || selectedProviderId === "claude" ? (
                      <Text color="gray">
                        › Browser opened on {selectedProviderId === "claude" ? "claude.com" : "auth.openai.com"}. Complete login.
                      </Text>
                    ) : (
                      <>
                        <Text color="gray">› Please open the authorization URL in your browser to log in:</Text>
                        <Box marginY={0.5} paddingX={1}>
                          <Text bold color="cyan" underline>{oauthUrl || "Generating authorization link..."}</Text>
                        </Box>
                      </>
                    )}
                    <Box marginTop={1}>
                      <Text bold color="yellow">⏳ Waiting for browser callback... (Automatic login)</Text>
                    </Box>
                    {oauthError && (
                      <Box marginTop={1}>
                        <Text color="red">❌ {oauthError}</Text>
                      </Box>
                    )}
                  </Box>
                )}
              </Box>
            )}

            {credSubStep === "project" && (
              <Box flexDirection="column" marginTop={1}>
                <Box flexDirection="row">
                  <Text bold color="cyan">
                    {selectedAuthMethod.kind === "oauth"
                      ? "GCP Project ID (required for OAuth attribution): "
                      : "GCP Project ID: "}
                  </Text>
                  <TextInput
                    value={gcpProjectId}
                    onChange={setGcpProjectId}
                    onSubmit={onSubmitProject}
                  />
                </Box>
                <Box marginTop={1} borderStyle="single" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false} borderColor="gray" paddingTop={0.5}>
                  <Text dimColor color="gray">Press [Enter] to continue</Text>
                </Box>
              </Box>
            )}

            {credSubStep === "region" && (
              <Box flexDirection="column" marginTop={1}>
                <Box flexDirection="row">
                  <Text bold color="cyan">
                    GCP Region (default: us-central1):{" "}
                  </Text>
                  <TextInput
                    value={gcpRegion}
                    onChange={setGcpRegion}
                    onSubmit={onSubmitRegion}
                  />
                </Box>
                <Box marginTop={1} borderStyle="single" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false} borderColor="gray" paddingTop={0.5}>
                  <Text dimColor color="gray">Press [Enter] to continue</Text>
                </Box>
              </Box>
            )}
          </Box>
        )}

        {step === "model" && catalogEntry && (
          <Box flexDirection="column">
            <Text bold color="cyan">🤖 SELECT ACTIVE MODEL</Text>
            <Text color="gray" dimColor>Choose the default LLM model to use:</Text>
            <Box marginTop={1} flexDirection="column">
              <SelectInput
                items={catalogEntry.availableModels.map((m) => ({
                  key: m,
                  label: m,
                  value: m,
                }))}
                onSelect={onSelectModel}
              />
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}

import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import React, { useState, useEffect } from "react";
import {
  PROVIDER_CATALOG,
  listProviders,
  startOAuthFlow,
  openBrowser,
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

  // 1. Clear terminal screen on mount to ensure clean, viewport-aligned rendering
  useEffect(() => {
    process.stdout.write("\u001b[2J\u001b[H");
  }, []);

  // 2. Initialize dynamic Google OAuth loopback flow asynchronously
  useEffect(() => {
    let activeSession: any = null;
    if (selectedAuthMethod?.kind === "oauth" && step === "credential" && !oauthUrl) {
      setOauthLoading(true);
      setOauthError(null);
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
        });
    }

    return () => {
      if (activeSession) {
        activeSession.stop();
      }
    };
  }, [selectedAuthMethod?.id, step]);

  // Unique list of companies from PROVIDER_CATALOG
  const companyItems = Array.from(
    new Set(listProviders().map((p) => p.company))
  ).map((c) => ({
    key: c,
    label: c === "Google" ? "Google Gemini" : c,
    value: c,
  }));

  function onSelectCompany(item: { value: string }) {
    setSelectedCompany(item.value);
    const provider = listProviders().find((p) => p.company === item.value);
    if (provider) {
      setSelectedProviderId(provider.id);
    }
    setStep("authMethod");
  }

  function onSelectAuthMethod(item: { value: AuthMethod }) {
    setSelectedAuthMethod(item.value);
    setSecret(item.value.kind === "baseUrl" ? "http://localhost:11434" : "");
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
      credentials = { type: "claude", apiKey: secret.trim() };
    } else if (selectedProviderId === "openai") {
      credentials = { type: "openai", apiKey: secret.trim() };
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
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {/* ASCII Splash Logo */}
      <Text bold color="cyan">
        {WELCOME_LOGO}
      </Text>
      <Box marginBottom={1}>
        <Text color="gray">
          ✦ Setup your environment to begin collaborating with the agent.
        </Text>
      </Box>

      {/* Main Wizard Area */}
      <Box flexDirection="column" marginTop={1}>
        {step === "company" && (
          <Box flexDirection="column">
            <Text bold color="cyan">🔐 SELECT PROVIDER COMPANY</Text>
            <Box marginTop={0.5} flexDirection="column">
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
            <Box marginTop={0.5} flexDirection="column">
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

            {credSubStep === "input" && (
              <Box flexDirection="column" marginTop={0.5}>
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
                <Box marginTop={1}>
                  <Text dimColor color="gray">Press [Enter] to submit credentials</Text>
                </Box>
              </Box>
            )}

            {credSubStep === "oauth_code" && (
              <Box flexDirection="column" marginTop={0.5}>
                {oauthLoading ? (
                  <Text color="yellow">⏳ Starting secure loopback callback server...</Text>
                ) : (
                  <Box flexDirection="column">
                    <Text color="gray">› Please open the authorization URL in your browser to log in:</Text>
                    <Box marginY={0.5} paddingX={1}>
                      <Text bold color="cyan" underline>{oauthUrl || "Generating authorization link..."}</Text>
                    </Box>
                    <Box marginTop={0.5}>
                      <Text bold color="yellow">⏳ Waiting for browser callback... (Automatic login)</Text>
                    </Box>
                    {oauthError && (
                      <Box marginTop={0.5}>
                        <Text color="red">❌ {oauthError}</Text>
                      </Box>
                    )}
                  </Box>
                )}
              </Box>
            )}

            {credSubStep === "project" && (
              <Box flexDirection="column" marginTop={0.5}>
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
                <Box marginTop={1}>
                  <Text dimColor color="gray">Press [Enter] to continue</Text>
                </Box>
              </Box>
            )}

            {credSubStep === "region" && (
              <Box flexDirection="column" marginTop={0.5}>
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
                <Box marginTop={1}>
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
            <Box marginTop={0.5} flexDirection="column">
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

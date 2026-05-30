import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import React, { useState } from "react";
import {
  PROVIDER_CATALOG,
  listProviders,
  type ProviderCredentials,
  type ProviderId,
} from "@luckycli/core";

export interface SetupResult {
  provider: ProviderId;
  model: string;
  credentials: ProviderCredentials;
}

interface SetupProps {
  onComplete: (result: SetupResult) => void;
}

type Step = "provider" | "secret" | "model";

const WELCOME_LOGO = `
 _               _              _____ _      _____ 
| |             | |            / ____| |    |_   _|
| |    _   _  __| | ___ _   _ | |    | |      | |  
| |   | | | |/ _\` |/ __| | | || |    | |      | |  
| |___| |_| | (_| | (__| |_| || |____| |____ _| |_ 
|______\\__,_|\\__,_|\\___|\\__, | \\_____|______|_____|
                        __/ |                     
                       |___/                      
`;

/**
 * First-run (and on-demand) login & setup wizard.
 * Renders a gorgeous welcome logo and wraps the wizard in a structured login card.
 */
export function Setup({ onComplete }: SetupProps): React.JSX.Element {
  const [step, setStep] = useState<Step>("provider");
  const [provider, setProvider] = useState<ProviderId | null>(null);
  const [secret, setSecret] = useState("");

  const entry = provider ? PROVIDER_CATALOG[provider] : null;

  const providerItems = listProviders().map((p) => ({
    key: p.id,
    label: p.displayName,
    value: p.id,
  }));

  function onPickProvider(item: { label: string; value: ProviderId }) {
    setProvider(item.value);
    const cat = PROVIDER_CATALOG[item.value];
    setSecret(cat.auth === "baseUrl" ? "http://localhost:11434" : "");
    setStep("secret");
  }

  function onSubmitSecret() {
    if (!secret.trim()) return;
    setStep("model");
  }

  function onPickModel(item: { label: string; value: string }) {
    if (!provider || !entry) return;
    onComplete({
      provider,
      model: item.value,
      credentials: buildCredentials(provider, secret.trim()),
    });
  }

  return (
    <Box flexDirection="column" padding={1}>
      {/* ASCII Splash Logo */}
      <Text bold color="magenta">
        {WELCOME_LOGO}
      </Text>
      <Box marginBottom={1}>
        <Text color="gray">
          ✦ Setup your environment to begin collaborating with the agent.
        </Text>
      </Box>

      {/* Login Card Box */}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="magenta"
        paddingX={1}
        paddingY={0.5}
        width="100%"
      >
        <Box marginBottom={1}>
          <Text bold color="magenta">🔐 PROVIDER LOGIN</Text>
        </Box>

        {step === "provider" ? (
          <Box flexDirection="column">
            <Text color="cyan">Select your model provider:</Text>
            <Box marginTop={0.5}>
              <SelectInput<ProviderId>
                items={providerItems}
                onSelect={onPickProvider}
              />
            </Box>
          </Box>
        ) : null}

        {step === "secret" && entry ? (
          <Box flexDirection="column">
            <Text color="cyan">Authentication: {entry.displayName}</Text>
            <Box marginTop={0.5} flexDirection="row">
              <Text bold>
                {entry.auth === "apiKey" ? "API Key" : "Base URL"}{" "}
                <Text color="gray">({entry.authHint})</Text>:{" "}
              </Text>
              <TextInput
                value={secret}
                onChange={setSecret}
                onSubmit={onSubmitSecret}
                {...(entry.auth === "apiKey" ? { mask: "*" } : {})}
              />
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Press [Enter] to submit credentials</Text>
            </Box>
          </Box>
        ) : null}

        {step === "model" && entry ? (
          <Box flexDirection="column">
            <Text color="cyan">Choose a model for {entry.displayName}:</Text>
            <Box marginTop={0.5}>
              <SelectInput<string>
                items={entry.availableModels.map((m) => ({
                  key: m,
                  label: m,
                  value: m,
                }))}
                onSelect={onPickModel}
              />
            </Box>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

function buildCredentials(
  provider: ProviderId,
  secret: string,
): ProviderCredentials {
  switch (provider) {
    case "claude":
      return { type: "claude", apiKey: secret };
    case "openai":
      return { type: "openai", apiKey: secret };
    case "gemini":
      return { type: "gemini", apiKey: secret };
    case "ollama":
      return { type: "ollama", baseUrl: secret };
  }
}

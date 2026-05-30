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

/**
 * First-run (and on-demand) setup dialog: pick a provider, supply its key (or
 * base URL for Ollama), then pick a model. No .env editing required.
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
    <Box flexDirection="column" paddingY={1}>
      <Text bold color="magenta">
        ✦ Welcome to LuckyCLI
      </Text>

      {step === "provider" ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>Choose a provider:</Text>
          <SelectInput<ProviderId>
            items={providerItems}
            onSelect={onPickProvider}
          />
        </Box>
      ) : null}

      {step === "secret" && entry ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color="cyan">{entry.displayName}</Text>
          <Box>
            <Text>
              {entry.auth === "apiKey" ? "API key" : "Base URL"} (
              {entry.authHint}):{" "}
            </Text>
            <TextInput
              value={secret}
              onChange={setSecret}
              onSubmit={onSubmitSecret}
              {...(entry.auth === "apiKey" ? { mask: "*" } : {})}
            />
          </Box>
        </Box>
      ) : null}

      {step === "model" && entry ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>Choose a model:</Text>
          <SelectInput<string>
            items={entry.availableModels.map((m) => ({
              key: m,
              label: m,
              value: m,
            }))}
            onSelect={onPickModel}
          />
        </Box>
      ) : null}
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

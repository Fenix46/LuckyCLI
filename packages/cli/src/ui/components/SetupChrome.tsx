import { Box, Text } from "../../vendor/ink-compat.js";
import { TextField } from "./TextField.js";
import React from "react";
import type { AuthMethod, ProviderId } from "@luckycli/core";
import type { Theme } from "../themes.js";
import { visibleSteps, type CredentialSubStep, type Step } from "../lib/setup-steps.js";

/** Step dots plus the progress bar shown at the top of the wizard. */
export function SetupProgress({
  step,
  theme,
  mode,
}: {
  step: Step;
  theme: Theme;
  mode: "initial" | "provider";
}): React.JSX.Element {
  const steps = visibleSteps(mode);
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

export function SetupSection({
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

export function CredentialView({
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

export function SetupInput({
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

export function SetupNavigationHint({
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

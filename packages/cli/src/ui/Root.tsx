import React, { useState } from "react";
import {
  loadStoredConfig,
  resolveConfig,
  saveProviderSetup,
  saveStoredConfig,
  type Agent,
  type ProviderCredentials,
  type ProviderId,
  type ResolvedConfig,
  type Session,
} from "@luckycli/core";
import { buildAgent } from "../runtime.js";
import { App, type ApprovalRequest } from "./App.js";
import { SessionPicker } from "./SessionPicker.js";
import { Setup, type SetupResult } from "./Setup.js";

interface RootProps {
  config: ResolvedConfig;
  forceSetup: boolean;
  resume?: Session;
  /** Show the interactive session picker before starting (lucky --resume, no id). */
  pickResume?: boolean;
}

interface ActiveRuntime {
  agent: Agent;
  provider: ProviderId;
  model: string;
  credentials: ProviderCredentials;
}

/**
 * Top-level component. Decides between the setup dialog and the chat UI, and
 * rebuilds the agent when setup completes.
 */
export function Root({
  config,
  forceSetup,
  resume,
  pickResume,
}: RootProps): React.JSX.Element {
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null);
  const [resumeSession, setResumeSession] = useState<Session | null>(resume ?? null);
  const [picking, setPicking] = useState<boolean>(pickResume === true && !resume);

  function approveTool(name: string, input: unknown) {
    return new Promise<boolean>((resolve) => {
      setApprovalRequest({ name, input, resolve });
    });
  }

  const [runtime, setRuntime] = useState<ActiveRuntime | null>(() => {
    if (forceSetup || config.needsSetup) return null;
    if (!config.provider || !config.model || !config.credentials) return null;
    return {
      agent: buildAgent({
        provider: config.provider,
        model: config.model,
        credentials: config.credentials,
        system: config.system,
        approveTool,
        ...(config.temperature !== undefined
          ? { temperature: config.temperature }
          : {}),
        ...(config.maxTokens !== undefined
          ? { maxTokens: config.maxTokens }
          : {}),
        ...(resume?.messages?.length ? { messages: resume.messages } : {}),
      }),
      provider: config.provider,
      model: config.model,
      credentials: config.credentials,
    };
  });

  function onSetupComplete(result: SetupResult) {
    saveProviderSetup(result.provider, result.model, result.credentials);
    setRuntime({
      agent: buildAgent({
        provider: result.provider,
        model: result.model,
        credentials: result.credentials,
        system: config.system,
        approveTool,
        ...(config.temperature !== undefined
          ? { temperature: config.temperature }
          : {}),
        ...(config.maxTokens !== undefined
          ? { maxTokens: config.maxTokens }
          : {}),
        ...(resumeSession?.messages?.length
          ? { messages: resumeSession.messages }
          : {}),
      }),
      provider: result.provider,
      model: result.model,
      credentials: result.credentials,
    });
  }

  /** Resume a session chosen from the interactive picker. */
  function startSession(session: Session) {
    setResumeSession(session);
    setPicking(false);
    const resolved = resolveConfig({
      provider: session.provider,
      model: session.model,
    });
    if (
      resolved.needsSetup ||
      !resolved.provider ||
      !resolved.model ||
      !resolved.credentials
    ) {
      // Credentials for that provider are gone — fall into setup, then seed.
      setRuntime(null);
      return;
    }
    setRuntime({
      agent: buildAgent({
        provider: resolved.provider,
        model: resolved.model,
        credentials: resolved.credentials,
        system: config.system,
        approveTool,
        ...(config.temperature !== undefined
          ? { temperature: config.temperature }
          : {}),
        ...(config.maxTokens !== undefined
          ? { maxTokens: config.maxTokens }
          : {}),
        ...(session.messages.length ? { messages: session.messages } : {}),
      }),
      provider: resolved.provider,
      model: resolved.model,
      credentials: resolved.credentials,
    });
  }

  function onChangeModel(model: string) {
    if (!runtime) return;
    const cfg = loadStoredConfig();
    saveStoredConfig({
      ...cfg,
      provider: runtime.provider,
      model,
    });
    // Carry the conversation over so switching models mid-session keeps context
    // (and doesn't truncate the saved session).
    const carried = [...runtime.agent.messages];
    setRuntime({
      agent: buildAgent({
        provider: runtime.provider,
        model,
        credentials: runtime.credentials,
        system: config.system,
        approveTool,
        ...(config.temperature !== undefined
          ? { temperature: config.temperature }
          : {}),
        ...(config.maxTokens !== undefined
          ? { maxTokens: config.maxTokens }
          : {}),
        ...(carried.length ? { messages: carried } : {}),
      }),
      provider: runtime.provider,
      model,
      credentials: runtime.credentials,
    });
  }

  if (picking) {
    return (
      <SessionPicker
        onSelect={startSession}
        onCancel={() => setPicking(false)}
      />
    );
  }

  if (!runtime) return <Setup onComplete={onSetupComplete} />;

  return (
    <App
      agent={runtime.agent}
      meta={{ provider: runtime.provider, model: runtime.model }}
      approvalRequest={approvalRequest}
      setApprovalRequest={setApprovalRequest}
      onTriggerSetup={() => setRuntime(null)}
      onChangeModel={onChangeModel}
      {...(resumeSession ? { resumed: resumeSession } : {})}
    />
  );
}

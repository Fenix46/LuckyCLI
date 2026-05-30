import React, { useState } from "react";
import {
  loadStoredConfig,
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
import { Setup, type SetupResult } from "./Setup.js";

interface RootProps {
  config: ResolvedConfig;
  forceSetup: boolean;
  resume?: Session;
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
export function Root({ config, forceSetup, resume }: RootProps): React.JSX.Element {
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null);

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
      }),
      provider: result.provider,
      model: result.model,
      credentials: result.credentials,
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

  if (!runtime) return <Setup onComplete={onSetupComplete} />;

  return (
    <App
      agent={runtime.agent}
      meta={{ provider: runtime.provider, model: runtime.model }}
      approvalRequest={approvalRequest}
      setApprovalRequest={setApprovalRequest}
      onTriggerSetup={() => setRuntime(null)}
      onChangeModel={onChangeModel}
      {...(resume ? { resumed: resume } : {})}
    />
  );
}

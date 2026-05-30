import React, { useState } from "react";
import {
  saveProviderSetup,
  type Agent,
  type ResolvedConfig,
} from "@luckycli/core";
import { buildAgent } from "../runtime.js";
import { App } from "./App.js";
import { Setup, type SetupResult } from "./Setup.js";

interface RootProps {
  config: ResolvedConfig;
  forceSetup: boolean;
}

interface ActiveRuntime {
  agent: Agent;
  provider: string;
  model: string;
}

/**
 * Top-level component. Decides between the setup dialog and the chat UI, and
 * rebuilds the agent when setup completes.
 */
export function Root({ config, forceSetup }: RootProps): React.JSX.Element {
  const [runtime, setRuntime] = useState<ActiveRuntime | null>(() => {
    if (forceSetup || config.needsSetup) return null;
    if (!config.provider || !config.model || !config.credentials) return null;
    return {
      agent: buildAgent({
        provider: config.provider,
        model: config.model,
        credentials: config.credentials,
        system: config.system,
        ...(config.temperature !== undefined
          ? { temperature: config.temperature }
          : {}),
        ...(config.maxTokens !== undefined
          ? { maxTokens: config.maxTokens }
          : {}),
      }),
      provider: config.provider,
      model: config.model,
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
        ...(config.temperature !== undefined
          ? { temperature: config.temperature }
          : {}),
        ...(config.maxTokens !== undefined
          ? { maxTokens: config.maxTokens }
          : {}),
      }),
      provider: result.provider,
      model: result.model,
    });
  }

  if (!runtime) return <Setup onComplete={onSetupComplete} />;

  return (
    <App
      agent={runtime.agent}
      meta={{ provider: runtime.provider, model: runtime.model }}
    />
  );
}

import React, { useRef, useState } from "react";
import {
  loadStoredConfig,
  resolveConfig,
  saveProviderSetup,
  saveStoredConfig,
  type Agent,
  type AskUserRequest,
  type Message,
  type ProviderCredentials,
  type ProviderId,
  type ResolvedConfig,
  type Session,
  type ToolApproval,
} from "@luckycli/core";
import { buildAgent } from "../runtime.js";
import { App, type ApprovalRequest, type UserQuestionRequest } from "./App.js";
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

type SetupMode = "initial" | "provider";

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
  const [userQuestionRequest, setUserQuestionRequest] = useState<UserQuestionRequest | null>(null);
  const [resumeSession, setResumeSession] = useState<Session | null>(resume ?? null);
  const [picking, setPicking] = useState<boolean>(pickResume === true && !resume);
  const [setupMode, setSetupMode] = useState<SetupMode>(() =>
    config.needsSetup ? "initial" : "provider",
  );
  const [pendingMessages, setPendingMessages] = useState<Message[] | null>(null);
  const [setupFallbackRuntime, setSetupFallbackRuntime] = useState<ActiveRuntime | null>(null);
  const sessionApprovedTools = useRef<Set<string>>(new Set());

  function approveTool(name: string, input: unknown) {
    const key = approvalKey(name, input);
    if (sessionApprovedTools.current.has(key)) return "allow" satisfies ToolApproval;

    return new Promise<ToolApproval>((resolve) => {
      setApprovalRequest({
        name,
        input,
        resolve: (decision) => {
          if (decision === "always") {
            sessionApprovedTools.current.add(key);
          }
          resolve(decision);
        },
      });
    });
  }

  function askUser(request: AskUserRequest) {
    return new Promise<string>((resolve) => {
      setUserQuestionRequest({
        ...request,
        resolve,
      });
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
        permissions: config.permissions,
        approveTool,
        askUser,
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
    const carriedMessages = pendingMessages ?? resumeSession?.messages ?? [];
    setRuntime({
      agent: buildAgent({
        provider: result.provider,
        model: result.model,
        credentials: result.credentials,
        system: config.system,
        permissions: config.permissions,
        approveTool,
        askUser,
        ...(config.temperature !== undefined
          ? { temperature: config.temperature }
          : {}),
        ...(config.maxTokens !== undefined
          ? { maxTokens: config.maxTokens }
          : {}),
        ...(carriedMessages.length ? { messages: carriedMessages } : {}),
      }),
      provider: result.provider,
      model: result.model,
      credentials: result.credentials,
    });
    setPendingMessages(null);
    setSetupFallbackRuntime(null);
    setSetupMode("provider");
  }

  /** Resume a session chosen from the interactive picker. */
  function startSession(session: Session) {
    setResumeSession(session);
    setPicking(false);
    sessionApprovedTools.current.clear();
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
      setSetupMode("provider");
      setPendingMessages(session.messages);
      setSetupFallbackRuntime(null);
      setRuntime(null);
      return;
    }
    setRuntime({
      agent: buildAgent({
        provider: resolved.provider,
        model: resolved.model,
        credentials: resolved.credentials,
        system: config.system,
        permissions: config.permissions,
        approveTool,
        askUser,
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
        permissions: config.permissions,
        approveTool,
        askUser,
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

  function onTriggerProviderSetup() {
    setSetupMode("provider");
    setPendingMessages(runtime ? [...runtime.agent.messages] : null);
    setSetupFallbackRuntime(runtime);
    setRuntime(null);
  }

  function onCancelSetup() {
    setPendingMessages(null);
    if (setupFallbackRuntime) {
      setRuntime(setupFallbackRuntime);
      setSetupFallbackRuntime(null);
      return;
    }
    if (!config.needsSetup && config.provider && config.model && config.credentials) {
      const carriedMessages = resumeSession?.messages ?? [];
      setRuntime({
        agent: buildAgent({
          provider: config.provider,
          model: config.model,
          credentials: config.credentials,
          system: config.system,
          permissions: config.permissions,
          approveTool,
          askUser,
          ...(config.temperature !== undefined
            ? { temperature: config.temperature }
            : {}),
          ...(config.maxTokens !== undefined
            ? { maxTokens: config.maxTokens }
            : {}),
          ...(carriedMessages.length ? { messages: carriedMessages } : {}),
        }),
        provider: config.provider,
        model: config.model,
        credentials: config.credentials,
      });
    }
  }

  if (picking) {
    return (
      <SessionPicker
        onSelect={startSession}
        onCancel={() => setPicking(false)}
      />
    );
  }

  if (!runtime) {
    return (
      <Setup
        mode={setupMode}
        onComplete={onSetupComplete}
        {...(setupMode === "provider" ? { onCancel: onCancelSetup } : {})}
      />
    );
  }

  return (
    <App
      key={resumeSession?.id ?? "fresh"}
      agent={runtime.agent}
      meta={{ provider: runtime.provider, model: runtime.model }}
      approvalRequest={approvalRequest}
      setApprovalRequest={setApprovalRequest}
      userQuestionRequest={userQuestionRequest}
      setUserQuestionRequest={setUserQuestionRequest}
      onTriggerSetup={onTriggerProviderSetup}
      onChangeModel={onChangeModel}
      onTriggerResume={() => setPicking(true)}
      {...(resumeSession ? { resumed: resumeSession } : {})}
    />
  );
}

function approvalKey(name: string, input: unknown): string {
  return `${name}:${stableStringify(input)}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

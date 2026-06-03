import React, { useEffect, useRef, useState } from "react";
import { Text } from "ink";
import {
  loadStoredConfig,
  type McpManager,
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
import { projectNeedsTrustPrompt } from "@luckycli/core";
import { buildAgentRuntime } from "../runtime.js";
import { App, type ApprovalRequest, type PermissionMode, type UserQuestionRequest } from "./App.js";
import { SessionPicker } from "./SessionPicker.js";
import { Setup, type SetupResult } from "./Setup.js";
import { TrustPrompt } from "./TrustPrompt.js";

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
  mcpManager?: McpManager;
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
  // First open in this folder: ask to trust it (and offer to build the graph).
  // Once a decision is recorded it never re-prompts. Computed once at startup.
  const [trustNeeded, setTrustNeeded] = useState<boolean>(() =>
    projectNeedsTrustPrompt(process.cwd()),
  );
  const [setupMode, setSetupMode] = useState<SetupMode>(() =>
    config.needsSetup ? "initial" : "provider",
  );
  const [pendingMessages, setPendingMessages] = useState<Message[] | null>(null);
  const [setupFallbackRuntime, setSetupFallbackRuntime] = useState<ActiveRuntime | null>(null);
  const [booting, setBooting] = useState<boolean>(() =>
    !forceSetup && !config.needsSetup && !!config.provider && !!config.model && !!config.credentials,
  );
  const sessionApprovedTools = useRef<Set<string>>(new Set());
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("normal");
  const runtimeRef = useRef<ActiveRuntime | null>(null);
  const activationIdRef = useRef(0);
  // The agent captures `approveTool` at build time, so the closure must read the
  // mode from a ref (a state value would be stale inside the captured closure).
  const permissionModeRef = useRef<PermissionMode>("normal");

  function cyclePermissionMode() {
    // The ref is the source of truth (the agent's captured approveTool reads it);
    // state just mirrors it for rendering. Only two modes for now, so toggle.
    const next: PermissionMode =
      permissionModeRef.current === "normal" ? "acceptEdits" : "normal";
    permissionModeRef.current = next;
    // Returning to normal also forgets the session's "always" approvals, so the
    // user starts asking again from a clean slate.
    if (next === "normal") sessionApprovedTools.current.clear();
    setPermissionMode(next);
  }

  function approveTool(name: string, input: unknown) {
    const key = approvalScope(name, input);
    if (sessionApprovedTools.current.has(key)) return "allow" satisfies ToolApproval;
    // Accept-edits mode auto-approves file edits (writes/edits/patches) without
    // prompting; shell execution still always asks.
    if (permissionModeRef.current === "acceptEdits" && AUTO_ACCEPT_EDIT_TOOLS.has(name)) {
      return "allow" satisfies ToolApproval;
    }

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

  const [runtime, setRuntime] = useState<ActiveRuntime | null>(null);

  useEffect(() => {
    runtimeRef.current = runtime;
  }, [runtime]);

  useEffect(() => {
    return () => {
      void runtimeRef.current?.mcpManager?.close();
    };
  }, []);

  async function activateRuntime(next: {
    provider: ProviderId;
    model: string;
    credentials: ProviderCredentials;
    messages?: Message[];
  }) {
    const activationId = ++activationIdRef.current;
    setBooting(true);
    const built = await buildAgentRuntime({
      provider: next.provider,
      model: next.model,
      credentials: next.credentials,
      system: config.system,
      permissions: config.permissions,
      approveTool,
      askUser,
      mcp: config.mcp,
      ...(config.temperature !== undefined
        ? { temperature: config.temperature }
        : {}),
      ...(config.maxTokens !== undefined
        ? { maxTokens: config.maxTokens }
        : {}),
      ...(next.messages?.length ? { messages: next.messages } : {}),
    });

    if (activationId !== activationIdRef.current) {
      await built.mcpManager?.close();
      return;
    }

    setRuntime((current) => {
      void current?.mcpManager?.close();
      return {
        agent: built.agent,
        provider: next.provider,
        model: next.model,
        credentials: next.credentials,
        ...(built.mcpManager ? { mcpManager: built.mcpManager } : {}),
      };
    });
    setBooting(false);
  }

  useEffect(() => {
    if (forceSetup || config.needsSetup) {
      setBooting(false);
      return;
    }
    if (!config.provider || !config.model || !config.credentials) {
      setBooting(false);
      return;
    }
    void activateRuntime({
      provider: config.provider,
      model: config.model,
      credentials: config.credentials,
      ...(resume?.messages?.length ? { messages: resume.messages } : {}),
    });
  // Intentionally one-shot for initial boot config.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onSetupComplete(result: SetupResult) {
    saveProviderSetup(result.provider, result.model, result.credentials);
    const carriedMessages = pendingMessages ?? resumeSession?.messages ?? [];
    void activateRuntime({
      provider: result.provider,
      model: result.model,
      credentials: result.credentials,
      ...(carriedMessages.length ? { messages: carriedMessages } : {}),
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
    permissionModeRef.current = "normal";
    setPermissionMode("normal");
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
    void activateRuntime({
      provider: resolved.provider,
      model: resolved.model,
      credentials: resolved.credentials,
      ...(session.messages.length ? { messages: session.messages } : {}),
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
    void activateRuntime({
      provider: runtime.provider,
      model,
      credentials: runtime.credentials,
      ...(carried.length ? { messages: carried } : {}),
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
      void activateRuntime({
        provider: config.provider,
        model: config.model,
        credentials: config.credentials,
        ...(carriedMessages.length ? { messages: carriedMessages } : {}),
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

  if (booting && !runtime) {
    return <Text>Starting session...</Text>;
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

  if (trustNeeded) {
    return <TrustPrompt cwd={process.cwd()} onDone={() => setTrustNeeded(false)} />;
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
      mcpManager={runtime.mcpManager}
      onTriggerSetup={onTriggerProviderSetup}
      onChangeModel={onChangeModel}
      onTriggerResume={() => setPicking(true)}
      permissionMode={permissionMode}
      onCyclePermissionMode={cyclePermissionMode}
      {...(resumeSession ? { resumed: resumeSession } : {})}
    />
  );
}

/**
 * The scope at which an "always" approval is remembered for the session.
 *
 * Previously this keyed on the exact, full tool input, so "always" only ever
 * matched an identical call again — a write to a different file, or any change
 * in arguments, would re-prompt. We instead remember at a useful granularity,
 * mirroring how other coding agents work:
 *
 *  - exec: remember the specific command. Re-running the same command is
 *    auto-allowed; a different command still asks. (Volatile args like the
 *    timeout are ignored so they don't defeat the match.)
 *  - every other ask-level tool (write_file, edit_file, apply_patch, …):
 *    remember the whole tool, so approving once stops the re-prompts.
 */
/** Tools auto-approved while the session is in "accept edits" mode. */
const AUTO_ACCEPT_EDIT_TOOLS = new Set(["write_file", "edit_file", "apply_patch"]);

function approvalScope(name: string, input: unknown): string {
  if (name === "exec") {
    const command = (input as { command?: unknown } | null)?.command;
    if (typeof command === "string") return `exec:${command.trim()}`;
  }
  return name;
}

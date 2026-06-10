import React, { useEffect, useRef, useState } from "react";
import { Text } from "../vendor/ink-compat.js";
import {
  loadStoredConfig,
  type McpServerConfig,
  type McpManager,
  resolveConfig,
  saveProviderSetup,
  saveStoredConfig,
  type Agent,
  type AskUserRequest,
  type PlanProposal,
  type PlanDecision,
  type Message,
  type ProviderCredentials,
  type ProviderId,
  type ResolvedConfig,
  type Session,
  type ToolApproval,
  type SpawnAgentRequest,
  type SpawnAgentResult,
  type TokenUsage,
  createSessionId,
  setActiveTaskListId,
  cleanupOrphanTaskLists,
  listSessions,
  getProfile,
  resolveCredentials,
  runSubAgent as runSubAgentCore,
  type SkillActivator,
} from "@luckycli/core";
import { projectNeedsTrustPrompt } from "@luckycli/core";
import { buildAgentRuntime } from "../runtime.js";
import { App, type AgentUsageMap, type ApprovalRequest, type PermissionMode, type PlanRequest, type UserQuestionRequest } from "./App.js";
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
  skillActivator: SkillActivator;
  mcpManager?: McpManager;
}

type SetupMode = "initial" | "provider";

/**
 * Which MCP servers a runtime rebuild should load. Callers that just mutated the
 * config pass it as `override`; we must honor that value verbatim — including an
 * empty object, which means "the last server was removed" and must win over the
 * still-stale component state. Only fall back to `current` when no override is
 * given (model switch, provider switch, resume).
 */
export function resolveActivationMcp(
  override: Record<string, McpServerConfig> | undefined,
  current: Record<string, McpServerConfig>,
): Record<string, McpServerConfig> {
  return override ?? current;
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
  const [userQuestionRequest, setUserQuestionRequest] = useState<UserQuestionRequest | null>(null);
  const [planRequest, setPlanRequest] = useState<PlanRequest | null>(null);
  // Live token consumption per sub-agent, keyed by profile name. Populated while
  // spawn_agent runs and shown in the bottom AgentUsagePanel.
  const [agentUsage, setAgentUsage] = useState<AgentUsageMap>(() => new Map());
  const [resumeSession, setResumeSession] = useState<Session>(() => {
    if (resume) return resume;
    const now = Date.now();
    return {
      id: createSessionId(),
      createdAt: now,
      updatedAt: now,
      provider: config.provider ?? "openai",
      model: config.model ?? "",
      messages: [],
    };
  });
  const [picking, setPicking] = useState<boolean>(pickResume === true && !resume);

  // Bind the active task list to the current session id, so the bottom task
  // panel and the task_* tools read/write the list for THIS chat. A fresh chat
  // gets a new session id (empty list); resuming brings that session's tasks
  // back. Re-runs if the session changes (e.g. after the resume picker).
  useEffect(() => {
    setActiveTaskListId(resumeSession.id);
  }, [resumeSession.id]);

  // One-time cleanup of task lists left behind by sessions that no longer
  // exist, so a fresh chat starts clean without orphaned lists accumulating on
  // disk. Keep the active id and every still-resumable session id.
  useEffect(() => {
    const valid = new Set<string>([
      resumeSession.id,
      ...listSessions().map((s) => s.id),
    ]);
    cleanupOrphanTaskLists(valid);
    // Intentionally run once at startup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
  const [mcpConfig, setMcpConfig] = useState<Record<string, McpServerConfig>>(config.mcp);
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

  // Show the plan in the transcript (via planRequest, which App prints), then
  // collect the decision through the existing question UI. Mapping: the picked
  // option (or matching free text) becomes accept/modify/reject; any other free
  // text on "modify" is the revision feedback.
  async function presentPlan(plan: PlanProposal): Promise<PlanDecision> {
    const ACCEPT = "Accept and run";
    const MODIFY = "Modify";
    const REJECT = "Reject";
    setPlanRequest(plan);
    try {
      const answer = (
        await askUser({
          question: `Plan ready: ${plan.title}. Accept to create ${plan.tasks.length} task${plan.tasks.length === 1 ? "" : "s"} and run, Modify to request changes, or Reject.`,
          options: [ACCEPT, MODIFY, REJECT],
          allowFreeText: true,
        })
      ).trim();

      if (answer === ACCEPT) return { action: "accept" };
      if (answer === REJECT || /^(reject|no|cancel|annulla|rifiuta)$/i.test(answer)) {
        return { action: "reject" };
      }
      if (answer === MODIFY) return { action: "modify" };
      // Any other free text is treated as modification feedback.
      return { action: "modify", feedback: answer };
    } finally {
      setPlanRequest(null);
    }
  }

  // spawn_agent bridge: look up the profile, run it on its assigned provider via
  // the core sequential runner, and stream its running token usage into the
  // bottom panel. Credentials come from stored config — exactly the providers the
  // user is logged into — so a profile on an unauthenticated provider errors with
  // a clear message the model relays to the user.
  async function runSubAgent(
    request: SpawnAgentRequest,
    signal?: AbortSignal,
  ): Promise<SpawnAgentResult> {
    const profile = getProfile(request.agent);
    if (!profile) {
      throw new Error(
        `No sub-agent profile named "${request.agent}". Create or assign one in /agents.`,
      );
    }

    setAgentUsage((prev) => {
      const next = new Map(prev);
      next.set(profile.name, {
        provider: profile.provider,
        model: profile.model,
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      });
      return next;
    });

    const { report } = await runSubAgentCore(
      {
        profile,
        task: request.task,
        cwd: process.cwd(),
        system: config.system,
        resolveCredentials: (provider) =>
          resolveCredentials(provider, loadStoredConfig(), process.env),
        onUsage: (usage) =>
          setAgentUsage((prev) => {
            const next = new Map(prev);
            next.set(profile.name, {
              provider: profile.provider,
              model: profile.model,
              usage,
            });
            return next;
          }),
      },
      signal,
    );
    return { report };
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
    /**
     * MCP servers to load. Defaults to the current state, but callers that have
     * just changed the config must pass the next value explicitly: the state
     * setter is async, so `mcpConfig` is still the previous value in this render.
     */
    mcp?: Record<string, McpServerConfig>;
  }) {
    const activationId = ++activationIdRef.current;
    setBooting(true);
    const built = await buildAgentRuntime({
      provider: next.provider,
      model: next.model,
      credentials: next.credentials,
      system: config.system,
      // Recompose the system prompt from this session's context (enabled tools,
      // graph presence, sub-agent profiles) so conditional sections react to it.
      composeSystemFromContext: true,
      permissions: config.permissions,
      approveTool,
      askUser,
      presentPlan,
      runSubAgent,
      mcp: resolveActivationMcp(next.mcp, mcpConfig),
      ...(config.temperature !== undefined
        ? { temperature: config.temperature }
        : {}),
      ...(config.maxTokens !== undefined
        ? { maxTokens: config.maxTokens }
        : {}),
      ...(config.reasoningEffort
        ? { reasoningEffort: config.reasoningEffort }
        : {}),
      ...(config.thinkingEnabled !== undefined
        ? { thinkingEnabled: config.thinkingEnabled }
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
        skillActivator: built.skillActivator,
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
    const carriedMessages = pendingMessages ?? resumeSession.messages;
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
      const carriedMessages = resumeSession.messages;
      void activateRuntime({
        provider: config.provider,
        model: config.model,
        credentials: config.credentials,
        ...(carriedMessages.length ? { messages: carriedMessages } : {}),
      });
    }
  }

  function onMcpConfigChange(nextMcpConfig: Record<string, McpServerConfig>) {
    setMcpConfig(nextMcpConfig);
    if (!runtime) return;
    void activateRuntime({
      provider: runtime.provider,
      model: runtime.model,
      credentials: runtime.credentials,
      messages: [...runtime.agent.messages],
      // Pass the new config explicitly: setMcpConfig above hasn't applied yet,
      // so the closure's mcpConfig still holds the previous servers.
      mcp: nextMcpConfig,
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
      key={resumeSession.id}
      agent={runtime.agent}
      skillActivator={runtime.skillActivator}
      meta={{ provider: runtime.provider, model: runtime.model }}
      approvalRequest={approvalRequest}
      setApprovalRequest={setApprovalRequest}
      userQuestionRequest={userQuestionRequest}
      setUserQuestionRequest={setUserQuestionRequest}
      planRequest={planRequest}
      agentUsage={agentUsage}
      mcpManager={runtime.mcpManager}
      mcpConfig={mcpConfig}
      onMcpConfigChange={onMcpConfigChange}
      onTriggerSetup={onTriggerProviderSetup}
      onChangeModel={onChangeModel}
      onTriggerResume={() => setPicking(true)}
      permissionMode={permissionMode}
      onCyclePermissionMode={cyclePermissionMode}
      resumed={resumeSession}
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

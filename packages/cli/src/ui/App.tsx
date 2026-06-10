import { Box, Text, useApp, useWindowSize } from "../vendor/ink-compat.js";
import React, { useCallback, useState, useEffect, useRef, useMemo } from "react";
import {
  OfficialMcpRegistryCatalog,
  PROVIDER_CATALOG,
  type Agent,
  type CatalogServerSummary,
  type ContextStatus,
  type Message,
  type McpManager,
  type McpServerConfig,
  type ProviderStatus,
  type ProviderId,
  type ProviderQuotaStatus,
  type Session,
  type TokenUsage,
  type ToolResultMetadata,
  CodexModelCache,
  antigravityModelLabel,
  claudeEffortLevelsForModel,
  createSessionId,
  defaultEffortFor,
  deriveTitle,
  detectSelfUpdate,
  effortLevelsFor,
  fetchCodexModels,
  getProvider,
  getAutoUpdatePolicy,
  getReasoningEffort,
  getActiveTaskListId,
  getThinkingEnabled,
  isProviderId,
  listProfiles,
  saveProfile,
  deleteProfile,
  seedDefaultProfiles,
  listTasks,
  loadStoredConfig,
  onTasksUpdated,
  saveReasoningEffort,
  saveSession,
  saveStoredConfig,
  withMcpServer,
  withoutMcpServer,
  type CodexModel,
  type Task,
  type AgentProfile,
} from "@luckycli/core";
import { applyUpdateNow, checkForUpdate, updateRows } from "../update.js";
import { THEMES, themeById, type Theme } from "./themes.js";
import type { Item, CommandRow } from "./lib/items.js";
import { messagesToItems, patchLastTool } from "./lib/items.js";
import { buildInstalledMcpRows } from "./lib/mcp-rows.js";
import {
  getModelPickerState,
  getThemePickerState,
  validateModel,
} from "./lib/model-picker.js";
import {
  expandPastedRefs,
  pruneOrphanedPastes,
  type PastedContent,
  type PastedContents,
} from "./lib/paste.js";
import { formatStatusFooter } from "./lib/status.js";
import { installCatalogServer } from "./commands/mcp.js";
import { buildCommandRegistry, dispatchCommand, slashMenuEntries } from "./commands/registry.js";
import type { CommandContext } from "./commands/types.js";
import { useElapsedTimer } from "./hooks/useElapsedTimer.js";
import { useModalRouter, type ModalHandler } from "./hooks/useModalRouter.js";
import { useTurnRunner } from "./hooks/useTurnRunner.js";
import { APP_VERSION } from "./components/constants.js";
import { ChatInput } from "./components/ChatInput.js";
import { PickerHint } from "./components/PickerHint.js";
import { TaskPanel } from "./components/TaskPanel.js";
import { AgentUsagePanel } from "./components/AgentUsagePanel.js";
import { TranscriptList } from "./components/Transcript.js";
import { McpPanel, type McpPanelTab } from "./components/McpPanel.js";
import {
  AgentsPanel,
  AGENT_DRAFT_FIELDS,
  type AgentDraft,
  type AgentsPanelView,
} from "./components/AgentsPanel.js";
import { ApprovalRequestView } from "./components/Approval.js";
import { UserQuestionRequestView } from "./components/UserQuestion.js";
import type {
  ApprovalRequest,
  UserQuestionRequest,
  PlanRequest,
  PermissionMode,
  AgentUsageMap,
} from "./lib/requests.js";

interface AppMeta {
  provider: ProviderId;
  model: string;
}

export type {
  ApprovalRequest,
  UserQuestionRequest,
  PlanRequest,
  PermissionMode,
  AgentUsageMap,
} from "./lib/requests.js";

interface AppProps {
  agent: Agent;
  meta: AppMeta;
  approvalRequest: ApprovalRequest | null;
  setApprovalRequest: (req: ApprovalRequest | null) => void;
  userQuestionRequest: UserQuestionRequest | null;
  setUserQuestionRequest: (req: UserQuestionRequest | null) => void;
  planRequest: PlanRequest | null;
  agentUsage: AgentUsageMap;
  mcpManager?: McpManager;
  mcpConfig: Record<string, McpServerConfig>;
  onMcpConfigChange: (nextMcpConfig: Record<string, McpServerConfig>) => void;
  onTriggerSetup: () => void;
  onChangeModel: (model: string) => void;
  onTriggerResume: () => void;
  /** Current tool-approval mode, displayed in the footer. */
  permissionMode: PermissionMode;
  /** Cycle the tool-approval mode (Shift+Tab). */
  onCyclePermissionMode: () => void;
  /** A session loaded via --continue/--resume, replayed into the transcript. */
  resumed?: Session;
}


export function App({
  agent,
  meta,
  approvalRequest,
  setApprovalRequest,
  userQuestionRequest,
  setUserQuestionRequest,
  planRequest,
  agentUsage,
  mcpManager,
  mcpConfig,
  onMcpConfigChange,
  onTriggerSetup,
  onChangeModel,
  onTriggerResume,
  permissionMode,
  onCyclePermissionMode,
  resumed,
}: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const [items, setItems] = useState<Item[]>(() =>
    agent.messages.length > 0
      ? [{ kind: "intro" }, ...messagesToItems([...agent.messages])]
      : resumed && resumed.messages.length > 0
      ? [{ kind: "intro" }, ...messagesToItems(resumed.messages)]
      : [{ kind: "intro" }]
  );
  // Live work task list for the bottom checklist panel. Seeded from disk and
  // kept fresh by subscribing to the store's change emitter, which fires on
  // every task_create/task_update/reset (whether driven by the model's tools
  // or the /task command).
  // The task list is keyed by session id (set active at startup), so a fresh
  // chat shows an empty panel and a resumed session shows its own tasks.
  const taskListId = resumed?.id ?? getActiveTaskListId();
  const [tasks, setTasks] = useState<Task[]>(() => listTasks(taskListId));
  useEffect(() => {
    const refresh = (changedId: string) => {
      if (changedId === taskListId) setTasks(listTasks(taskListId));
    };
    return onTasksUpdated(refresh);
  }, [taskListId]);

  // When the agent presents a plan, print it into the transcript once so it
  // stays in the scrollback while the confirmation UI (below) collects the
  // accept/modify/reject decision. Keyed on identity so it fires per request.
  const printedPlanRef = useRef<PlanRequest | null>(null);
  useEffect(() => {
    if (planRequest && printedPlanRef.current !== planRequest) {
      printedPlanRef.current = planRequest;
      setItems((prev) => [
        ...prev,
        { kind: "plan", title: planRequest.title, markdown: planRequest.markdown },
      ]);
    }
  }, [planRequest]);

  // Session persistence: id + creation time, established lazily on first save.
  const sessionIdRef = useRef<string | null>(resumed?.id ?? null);
  const sessionCreatedAtRef = useRef<number>(resumed?.createdAt ?? Date.now());

  const persistSession = useCallback(() => {
    const messages = [...agent.messages];
    if (messages.length === 0) return;
    if (!sessionIdRef.current) sessionIdRef.current = createSessionId();
    const title = deriveTitle(messages);
    try {
      saveSession({
        id: sessionIdRef.current,
        ...(title ? { title } : {}),
        provider: meta.provider,
        model: meta.model,
        createdAt: sessionCreatedAtRef.current,
        updatedAt: Date.now(),
        messages,
      });
    } catch {
      // persistence is best-effort; never break the session over a write error
    }
  }, [agent, meta.provider, meta.model]);
  const [input, setInput] = useState("");
  // Large pastes are held out of the visible input behind a `[Pasted text #N]`
  // placeholder and spliced back in at submit time (see lib/paste.ts). Kept in
  // refs so the id counter and stash survive re-renders without re-triggering
  // input effects; only ever read synchronously at paste/submit time.
  const pastedContentsRef = useRef<PastedContents>({});
  const nextPasteIdRef = useRef<number>(1);
  // Timestamp of the last Ctrl+C while busy, so a quick second press can force
  // quit even if the running turn is wedged and won't honor the abort.
  const lastBusyCtrlCRef = useRef<number>(0);

  // Persistent Theme System
  const [activeTheme, setActiveTheme] = useState<Theme>(() => {
    try {
      const cfg = loadStoredConfig();
      return themeById(cfg.theme);
    } catch {
      return THEMES[0] as Theme;
    }
  });

  const applyTheme = useCallback((theme: Theme) => {
    setActiveTheme(theme);
    try {
      const cfg = loadStoredConfig();
      cfg.theme = theme.id;
      saveStoredConfig(cfg);
    } catch {
      // ignore
    }
    setItems((prevItems) => [
      ...prevItems,
      {
        kind: "command",
        title: "Theme",
        rows: [
          { label: "active", value: theme.name },
          { label: "id", value: theme.id },
          { label: "scope", value: "header, labels, borders, status and command panels" },
        ],
      },
    ]);
  }, []);

  const [contextStatus, setContextStatus] = useState<ContextStatus | null>(null);
  // True while a manual /compact is summarizing. Drives a "compacting…"
  // indicator and blocks re-running /compact (which otherwise fired several
  // times because the long await gave no feedback). compactStartedAt anchors
  // the spinner's elapsed readout.
  const [compacting, setCompacting] = useState(false);
  const [compactStartedAt, setCompactStartedAt] = useState<number | null>(null);

  const appendItems = useCallback(
    (next: Item[]) => {
      setItems((prev) => [...prev, ...next]);
    },
    [],
  );
  const patchTool = useCallback(
    (name: string, output: string, error: boolean, metadata?: ToolResultMetadata) =>
      setItems((prev) => patchLastTool(prev, name, output, error, metadata)),
    [],
  );
  const onUsage = useCallback((_usage: TokenUsage) => {}, []);
  const { busy, startedAt, streaming, reasoning, abort, runTurn } = useTurnRunner({
    agent,
    appendItems,
    patchTool,
    onContext: setContextStatus,
    onUsage,
    persist: persistSession,
  });
  const { elapsedSeconds, activityFrame } = useElapsedTimer(
    busy || compacting,
    busy ? startedAt : compactStartedAt,
  );

  // Terminal dimensions, re-rendering on resize (Ink's official hook).
  const { columns, rows } = useWindowSize();
  const terminalSize = { width: columns, height: rows };

  useEffect(() => {
    if (process.env.LUCKY_DISABLE_UPDATE_CHECK === "1") return;
    const policy = getAutoUpdatePolicy(loadStoredConfig());
    if (policy === "off") return;
    let cancelled = false;
    checkForUpdate(APP_VERSION)
      .then(async (info) => {
        if (cancelled || !info.updateAvailable) return;

        // "auto": download, verify and install right away, narrating progress
        // in the transcript. Swapping the on-disk binary is safe under a live
        // session — the running process keeps its loaded image — so the user
        // only has to restart lucky to be on the new version.
        if (policy === "auto" && info.latestVersion && detectSelfUpdate().ok) {
          const version = info.latestVersion;
          setItems((prev) => [
            ...prev,
            {
              kind: "command",
              title: "Update",
              rows: [
                { label: "version", value: version },
                { label: "status", value: "downloading in the background…" },
              ],
            },
          ]);
          try {
            const result = await applyUpdateNow(version);
            if (cancelled) return;
            if (result.applied) {
              setItems((prev) => [
                ...prev,
                {
                  kind: "command",
                  title: "Update installed",
                  rows: [
                    { label: "version", value: version },
                    { label: "status", value: "restart lucky to use the new version" },
                  ],
                },
              ]);
              return;
            }
            // Could not self-update (dev runtime, unwritable dir): fall
            // through to the notify banner with the manual command.
          } catch {
            // Download/verify failed; fall through to the notify banner.
          }
        }

        if (cancelled) return;
        setItems((prev) => [
          ...prev,
          {
            kind: "command",
            title: "Update Available",
            rows: updateRows(info),
          },
        ]);
      })
      .catch(() => {
        // Background update checks are best-effort. /update surfaces failures.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Slash commands: static registry; per-dispatch state travels in the
  // CommandContext. The menu and /help derive from the same list.
  const commandRegistry = useMemo(() => buildCommandRegistry(), []);
  const menuEntries = useMemo(() => slashMenuEntries(commandRegistry), [commandRegistry]);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const showSlashMenu = input.startsWith("/");
  const filteredCommands = menuEntries.filter((cmd) =>
    cmd.name.startsWith(input)
  );
  const [mcpPanelOpen, setMcpPanelOpen] = useState(false);
  const [mcpPanelTab, setMcpPanelTab] = useState<McpPanelTab>("installed");
  const [mcpPanelQuery, setMcpPanelQuery] = useState("");
  const [mcpPanelResults, setMcpPanelResults] = useState<CatalogServerSummary[]>([]);
  const [mcpPanelLoading, setMcpPanelLoading] = useState(false);
  const [mcpPanelError, setMcpPanelError] = useState<string | null>(null);
  const [selectedInstalledMcpIndex, setSelectedInstalledMcpIndex] = useState(0);
  const [selectedSearchMcpIndex, setSelectedSearchMcpIndex] = useState(0);

  // /agents control panel: list of profiles + an inline editor for create/edit.
  const [agentsPanelOpen, setAgentsPanelOpen] = useState(false);
  const [agentsView, setAgentsView] = useState<AgentsPanelView>("list");
  const [agentProfiles, setAgentProfiles] = useState<AgentProfile[]>([]);
  const [selectedAgentIndex, setSelectedAgentIndex] = useState(0);
  const [agentDraft, setAgentDraft] = useState<AgentDraft | null>(null);
  const [agentFieldIndex, setAgentFieldIndex] = useState(0);
  const [agentsPanelError, setAgentsPanelError] = useState<string | null>(null);
  // Providers the user is logged into, recomputed when the panel opens.
  const loggedInProviders = useMemo(() => {
    const creds = loadStoredConfig().credentials ?? {};
    return new Set(
      Object.keys(creds).filter(isProviderId) as ProviderId[],
    );
    // Recompute when the panel toggles so a fresh login is reflected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentsPanelOpen]);

  function refreshAgentProfiles(): AgentProfile[] {
    const profiles = listProfiles();
    setAgentProfiles(profiles);
    return profiles;
  }

  function openAgentsPanel(): void {
    // Seed example profiles the first time so the list isn't blank.
    seedDefaultProfiles();
    refreshAgentProfiles();
    setAgentsView("list");
    setSelectedAgentIndex(0);
    setAgentDraft(null);
    setAgentFieldIndex(0);
    setAgentsPanelError(null);
    setAgentsPanelOpen(true);
  }

  /** Models available for a provider, from the live catalog. */
  function modelsFor(provider: ProviderId): string[] {
    return PROVIDER_CATALOG[provider]?.availableModels ?? [];
  }

  /** Cycle the draft's provider (and reset its model to that provider's default). */
  function cycleDraftProvider(dir: 1 | -1): void {
    setAgentDraft((prev) => {
      if (!prev) return prev;
      const ids = Object.keys(PROVIDER_CATALOG) as ProviderId[];
      const i = ids.indexOf(prev.provider);
      const nextProvider = ids[(i + dir + ids.length) % ids.length] ?? prev.provider;
      const models = modelsFor(nextProvider);
      return {
        ...prev,
        provider: nextProvider,
        model: models[0] ?? prev.model,
      };
    });
  }

  /** Cycle the draft's model within its current provider. */
  function cycleDraftModel(dir: 1 | -1): void {
    setAgentDraft((prev) => {
      if (!prev) return prev;
      const models = modelsFor(prev.provider);
      if (models.length === 0) return prev;
      const i = Math.max(0, models.indexOf(prev.model));
      return { ...prev, model: models[(i + dir + models.length) % models.length] ?? prev.model };
    });
  }

  /** Validate and persist the current draft, then return to the list. */
  function commitAgentDraft(): void {
    const draft = agentDraft;
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) {
      setAgentsPanelError("Name is required.");
      return;
    }
    // Block a rename/create that would collide with a different existing profile.
    const collision = agentProfiles.find(
      (p) => p.name === name && p.name !== draft.original,
    );
    if (collision) {
      setAgentsPanelError(`A sub-agent named "${name}" already exists.`);
      return;
    }
    try {
      // On rename, remove the old file so it doesn't linger as a duplicate.
      if (draft.original && draft.original !== name) deleteProfile(draft.original);
      saveProfile({
        name,
        description: draft.description.trim(),
        provider: draft.provider,
        model: draft.model,
      });
    } catch (err) {
      setAgentsPanelError(err instanceof Error ? err.message : "failed to save sub-agent");
      return;
    }
    const profiles = refreshAgentProfiles();
    setAgentsView("list");
    setAgentDraft(null);
    setAgentsPanelError(null);
    const idx = profiles.findIndex((p) => p.name === name);
    setSelectedAgentIndex(idx >= 0 ? idx : 0);
  }
  // Live Codex model catalog (openai-oauth only), fetched on demand and cached
  // for the session. The picker reads these slugs instead of a hardcoded list.
  const codexCacheRef = useRef<CodexModelCache | null>(null);
  const [codexModels, setCodexModels] = useState<CodexModel[]>([]);
  const antigravityModelsRef = useRef<Promise<string[]> | null>(null);
  const [antigravityModels, setAntigravityModels] = useState<string[]>([]);
  const liveModels =
    meta.provider === "openai-oauth"
      ? codexModels.map((m) => m.slug)
      : meta.provider === "antigravity"
        ? antigravityModels
        : undefined;

  const modelPicker = getModelPickerState(input, meta.provider, meta.model, liveModels);
  const [selectedModelIndex, setSelectedModelIndex] = useState(0);

  // Second step of the openai-oauth picker: choose a reasoning effort.
  const [effortPicker, setEffortPicker] = useState<{ model: string; levels: string[] } | null>(null);
  const [selectedEffortIndex, setSelectedEffortIndex] = useState(0);

  const themePicker = getThemePickerState(input, activeTheme.id);
  const [selectedThemeIndex, setSelectedThemeIndex] = useState(0);
  const approvalOptions = ["allow", "always", "deny"] as const;
  const [selectedApprovalIndex, setSelectedApprovalIndex] = useState(0);
  const [selectedQuestionOptionIndex, setSelectedQuestionOptionIndex] = useState(0);

  useEffect(() => {
    setSelectedModelIndex(0);
  }, [modelPicker.query, meta.provider]);

  useEffect(() => {
    setSelectedThemeIndex(0);
  }, [themePicker.query]);

  useEffect(() => {
    setSelectedApprovalIndex(0);
  }, [approvalRequest]);

  useEffect(() => {
    setSelectedQuestionOptionIndex(0);
  }, [userQuestionRequest]);

  useEffect(() => {
    setSelectedInstalledMcpIndex(0);
  }, [mcpPanelOpen, mcpPanelTab, mcpConfig]);

  useEffect(() => {
    setSelectedSearchMcpIndex(0);
  }, [mcpPanelOpen, mcpPanelTab, mcpPanelQuery, mcpPanelResults.length]);

  const footerEffort =
    meta.provider === "openai-oauth" || meta.provider === "claude"
      ? getReasoningEffort(loadStoredConfig(), meta.provider)
      : undefined;
  const footerThinking =
    meta.provider === "claude"
      ? getThinkingEnabled(loadStoredConfig(), meta.provider)
        ? "adaptive"
        : "off"
      : undefined;

  useEffect(() => {
    if (!mcpPanelOpen || mcpPanelTab !== "search") return;
    const query = mcpPanelQuery.trim();
    if (!query) {
      setMcpPanelResults([]);
      setMcpPanelLoading(false);
      setMcpPanelError(null);
      return;
    }
    let cancelled = false;
    setMcpPanelLoading(true);
    setMcpPanelError(null);
    const timer = setTimeout(() => {
      void new OfficialMcpRegistryCatalog()
        .search(query)
        .then((result) => {
          if (cancelled) return;
          setMcpPanelResults(result.items);
          setMcpPanelLoading(false);
        })
        .catch((error) => {
          if (cancelled) return;
          setMcpPanelResults([]);
          setMcpPanelLoading(false);
          setMcpPanelError(error instanceof Error ? error.message : "failed to search MCP catalog");
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mcpPanelOpen, mcpPanelTab, mcpPanelQuery]);

  const installedMcpRows = buildInstalledMcpRows(mcpConfig, mcpManager?.status() ?? {});

  const openMcpPanel = useCallback((tab: McpPanelTab, query = "") => {
    setMcpPanelOpen(true);
    setMcpPanelTab(tab);
    setMcpPanelQuery(query);
    setMcpPanelError(null);
    if (tab === "installed") {
      setMcpPanelResults([]);
      setMcpPanelLoading(false);
    }
  }, []);

  // All modal keyboard handling goes through one useInput (the router). The
  // array order IS the precedence chain, top = highest priority. Handlers
  // close over this render's state; "return true" consumes the key within
  // App's chain (ChatInput keeps its own useInput and still sees every key).
  //
  // Scrolling is handled natively by the terminal: the transcript renders
  // into the normal screen (not an alt-screen ScrollBox), so PageUp/PageDown,
  // the wheel and the scrollbar all drive the terminal's own scrollback. We
  // intentionally do NOT intercept those keys here.
  const modalHandlers: ModalHandler[] = [
    // 1. Tool safety approval has highest precedence
    {
      active: Boolean(approvalRequest),
      onInput(_in, key) {
        if (!approvalRequest) return false;
        if (key.ctrl && _in === "c") {
          approvalRequest.resolve("deny");
          setApprovalRequest(null);
          abort();
          return true;
        }
        if (key.leftArrow || key.upArrow || _in === "h" || _in === "k") {
          setSelectedApprovalIndex(
            (prev) => (prev - 1 + approvalOptions.length) % approvalOptions.length,
          );
          return true;
        }
        if (key.rightArrow || key.downArrow || _in === "l" || _in === "j" || key.tab) {
          setSelectedApprovalIndex((prev) => (prev + 1) % approvalOptions.length);
          return true;
        }
        if (key.return) {
          const decision = approvalOptions[selectedApprovalIndex] ?? "deny";
          approvalRequest.resolve(decision);
          setApprovalRequest(null);
          // Refusing a tool stops the whole turn, like Esc — the model does
          // not get to react to the denial and keep working.
          if (decision === "deny") abort();
          return true;
        }
        if (key.escape) {
          approvalRequest.resolve("deny");
          setApprovalRequest(null);
          abort();
        }
        return true; // swallow everything else while the approval is open
      },
    },
    // 2. User question from ask_user tool
    {
      active: Boolean(userQuestionRequest),
      onInput(_in, key) {
        if (!userQuestionRequest) return false;
        const options = userQuestionRequest.options ?? [];
        if (key.ctrl && _in === "c") {
          userQuestionRequest.resolve("User cancelled the question.");
          setUserQuestionRequest(null);
          abort();
          return true;
        }
        if (options.length > 0 && (key.leftArrow || key.upArrow || _in === "h" || _in === "k")) {
          setSelectedQuestionOptionIndex(
            (prev) => (prev - 1 + options.length) % options.length,
          );
          return true;
        }
        if (options.length > 0 && (key.rightArrow || key.downArrow || _in === "l" || _in === "j" || key.tab)) {
          setSelectedQuestionOptionIndex((prev) => (prev + 1) % options.length);
          return true;
        }
        if (key.return && options.length > 0 && !userQuestionRequest.allowFreeText) {
          userQuestionRequest.resolve(options[selectedQuestionOptionIndex] ?? options[0] ?? "");
          setUserQuestionRequest(null);
          return true;
        }
        if (key.escape) {
          userQuestionRequest.resolve("User skipped the question.");
          setUserQuestionRequest(null);
          abort();
        }
        return true; // swallow everything else while the question is open
      },
    },
    // 2.5 MCP control panel (state machine moves to useMcpPanel in task 7)
    {
      active: mcpPanelOpen,
      onInput(_in, key) {
        if (key.escape) {
          setMcpPanelOpen(false);
          setMcpPanelError(null);
          return true;
        }
        if (key.leftArrow || key.rightArrow || key.tab) {
          setMcpPanelTab((prev) => (prev === "installed" ? "search" : "installed"));
          return true;
        }
        if (mcpPanelTab === "installed") {
          if (installedMcpRows.length > 0 && key.downArrow) {
            setSelectedInstalledMcpIndex((prev) => (prev + 1) % installedMcpRows.length);
            return true;
          }
          if (installedMcpRows.length > 0 && key.upArrow) {
            setSelectedInstalledMcpIndex((prev) => (prev - 1 + installedMcpRows.length) % installedMcpRows.length);
            return true;
          }
          const selected = installedMcpRows[selectedInstalledMcpIndex];
          if (key.return && selected) {
            toggleInstalledServer(selected.name);
            return true;
          }
          if ((_in === "d" || _in === "D") && selected) {
            removeInstalledServer(selected.name);
            return true;
          }
          if (_in === "r" || _in === "R") {
            onMcpConfigChange(mcpConfig);
            setItems((prev) => [
              ...prev,
              { kind: "command", title: "MCP Reload", rows: [{ label: "status", value: "reloading configured MCP servers" }] },
            ]);
          }
          return true;
        }
        if (mcpPanelResults.length > 0 && key.downArrow) {
          setSelectedSearchMcpIndex((prev) => (prev + 1) % mcpPanelResults.length);
          return true;
        }
        if (mcpPanelResults.length > 0 && key.upArrow) {
          setSelectedSearchMcpIndex((prev) => (prev - 1 + mcpPanelResults.length) % mcpPanelResults.length);
          return true;
        }
        if (key.backspace || key.delete) {
          if (mcpPanelQuery.length > 0) setMcpPanelQuery((prev) => prev.slice(0, -1));
          return true;
        }
        if (key.return) {
          const selected = mcpPanelResults[selectedSearchMcpIndex];
          if (!selected) return true;
          setMcpPanelLoading(true);
          setMcpPanelError(null);
          void installCatalogServer(selected.name, onMcpConfigChange, (item) =>
            setItems((prev) => [...prev, item]),
          )
            .then(() => {
              setMcpPanelLoading(false);
              setMcpPanelTab("installed");
              setMcpPanelQuery("");
            })
            .catch((error) => {
              setMcpPanelLoading(false);
              setMcpPanelError(error instanceof Error ? error.message : "failed to add MCP server");
            });
          return true;
        }
        if (!key.ctrl && !key.meta && !key.return && _in) {
          setMcpPanelQuery((prev) => prev + _in);
        }
        return true; // panel owns the keyboard while open
      },
    },
    // 2.6 Sub-agents (/agents) control panel (moves to useAgentsPanel in task 7)
    {
      active: agentsPanelOpen,
      onInput(_in, key) {
        if (agentsView === "list") {
          if (key.escape) {
            setAgentsPanelOpen(false);
            setAgentsPanelError(null);
            return true;
          }
          if (agentProfiles.length > 0 && key.downArrow) {
            setSelectedAgentIndex((prev) => (prev + 1) % agentProfiles.length);
            return true;
          }
          if (agentProfiles.length > 0 && key.upArrow) {
            setSelectedAgentIndex((prev) => (prev - 1 + agentProfiles.length) % agentProfiles.length);
            return true;
          }
          if (_in === "n" || _in === "N") {
            const provider = (Object.keys(PROVIDER_CATALOG) as ProviderId[])[0] ?? "claude";
            setAgentDraft({
              original: null,
              name: "",
              description: "",
              provider,
              model: modelsFor(provider)[0] ?? PROVIDER_CATALOG[provider].defaultModel,
            });
            setAgentFieldIndex(0);
            setAgentsPanelError(null);
            setAgentsView("edit");
            return true;
          }
          const selected = agentProfiles[selectedAgentIndex];
          if ((_in === "e" || _in === "E") && selected) {
            setAgentDraft({
              original: selected.name,
              name: selected.name,
              description: selected.description,
              provider: selected.provider,
              model: selected.model,
            });
            setAgentFieldIndex(0);
            setAgentsPanelError(null);
            setAgentsView("edit");
            return true;
          }
          if ((_in === "d" || _in === "D") && selected) {
            deleteProfile(selected.name);
            const profiles = refreshAgentProfiles();
            setSelectedAgentIndex((prev) => Math.max(0, Math.min(prev, profiles.length - 1)));
          }
          return true;
        }

        // edit view
        if (key.escape) {
          setAgentsView("list");
          setAgentDraft(null);
          setAgentsPanelError(null);
          return true;
        }
        if (key.downArrow || key.tab) {
          setAgentFieldIndex((prev) => (prev + 1) % AGENT_DRAFT_FIELDS.length);
          return true;
        }
        if (key.upArrow) {
          setAgentFieldIndex((prev) => (prev - 1 + AGENT_DRAFT_FIELDS.length) % AGENT_DRAFT_FIELDS.length);
          return true;
        }
        if (key.return) {
          commitAgentDraft();
          return true;
        }
        const field = AGENT_DRAFT_FIELDS[agentFieldIndex];
        if (field === "provider") {
          if (key.leftArrow) cycleDraftProvider(-1);
          else if (key.rightArrow) cycleDraftProvider(1);
          return true;
        }
        if (field === "model") {
          if (key.leftArrow) cycleDraftModel(-1);
          else if (key.rightArrow) cycleDraftModel(1);
          return true;
        }
        // name / description: free text editing
        const textField: "name" | "description" =
          field === "description" ? "description" : "name";
        if (key.backspace || key.delete) {
          setAgentDraft((prev) =>
            prev ? { ...prev, [textField]: prev[textField].slice(0, -1) } : prev,
          );
          return true;
        }
        if (!key.ctrl && !key.meta && _in) {
          setAgentDraft((prev) =>
            prev ? { ...prev, [textField]: prev[textField] + _in } : prev,
          );
        }
        return true; // panel owns the keyboard while open
      },
    },
    // 3a. Effort picker (second step of /model, provider-specific)
    {
      active: Boolean(effortPicker),
      onInput(_in, key) {
        if (!effortPicker) return false;
        if (key.escape) {
          setEffortPicker(null);
          setSelectedEffortIndex(0);
          return true;
        }
        if (effortPicker.levels.length === 0) return true;
        if (key.downArrow) {
          setSelectedEffortIndex((prev) => (prev + 1) % effortPicker.levels.length);
          return true;
        }
        if (key.upArrow) {
          setSelectedEffortIndex(
            (prev) => (prev - 1 + effortPicker.levels.length) % effortPicker.levels.length,
          );
          return true;
        }
        if (key.return) {
          const effort = effortPicker.levels[selectedEffortIndex];
          if (effort) applyEffort(effortPicker.model, effort);
          return true;
        }
        return true; // swallow other keys while the effort step is open
      },
    },
    // 3. Model picker: unhandled keys fall through so typing filters the list
    {
      active: modelPicker.open,
      onInput(_in, key) {
        if (key.escape) {
          setInput("");
          setSelectedModelIndex(0);
          return true;
        }
        if (modelPicker.items.length === 0) return true;
        if (key.downArrow) {
          setSelectedModelIndex((prev) => (prev + 1) % modelPicker.items.length);
          return true;
        }
        if (key.upArrow) {
          setSelectedModelIndex(
            (prev) => (prev - 1 + modelPicker.items.length) % modelPicker.items.length,
          );
          return true;
        }
        if (key.return) {
          const selected = modelPicker.items[selectedModelIndex];
          if (selected) selectModel(selected);
          return true;
        }
        return false;
      },
    },
    // 3. Theme picker: same fall-through contract as the model picker
    {
      active: themePicker.open,
      onInput(_in, key) {
        if (key.escape) {
          setInput("");
          setSelectedThemeIndex(0);
          return true;
        }
        if (themePicker.items.length === 0) return true;
        if (key.downArrow) {
          setSelectedThemeIndex((prev) => (prev + 1) % themePicker.items.length);
          return true;
        }
        if (key.upArrow) {
          setSelectedThemeIndex(
            (prev) => (prev - 1 + themePicker.items.length) % themePicker.items.length,
          );
          return true;
        }
        if (key.return) {
          const selected = themePicker.items[selectedThemeIndex];
          if (selected) selectTheme(selected.id);
          return true;
        }
        return false;
      },
    },
    // 4. Slash commands menu (suppressed while a picker refines the command)
    {
      active: showSlashMenu && !modelPicker.open && !themePicker.open,
      onInput(_in, key) {
        if (key.escape) {
          setInput("");
          setSelectedCommandIndex(0);
          return true;
        }
        if (filteredCommands.length === 0) return true;
        if (key.downArrow) {
          setSelectedCommandIndex((prev) => (prev + 1) % filteredCommands.length);
          return true;
        }
        if (key.upArrow) {
          setSelectedCommandIndex(
            (prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length,
          );
          return true;
        }
        if (key.tab || (key.return && input !== filteredCommands[selectedCommandIndex]?.name)) {
          const completed = filteredCommands[selectedCommandIndex]?.name;
          if (completed) {
            setInput(completed);
            setSelectedCommandIndex(0);
          }
          return true;
        }
        return false;
      },
    },
  ];

  const { anyModalActive } = useModalRouter(modalHandlers, {
    // 0. Shift+Tab cycles the session permission mode. Intercept it before
    // any handler so it never triggers a plain-Tab action (option cycling,
    // slash-command completion). Ignore it while a modal/picker owns the keys.
    pre: (_in, key, modalActive) => {
      if (key.tab && key.shift) {
        if (!modalActive) onCyclePermissionMode();
        return true;
      }
      return false;
    },
    fallthrough: (_in, key) => {
      // 5. Esc interrupts the running turn (like other coding agents).
      if (key.escape && busy) {
        abort();
        return;
      }
      // 6. Ctrl+C: while busy, abort the turn; a second press within 2s force
      // quits, guaranteeing an escape hatch even if the turn ignores the abort.
      if (key.ctrl && _in === "c" && busy) {
        const now = Date.now();
        if (now - lastBusyCtrlCRef.current < 2000) {
          exit();
          return;
        }
        lastBusyCtrlCRef.current = now;
        abort();
        return;
      }
      if (key.ctrl && _in === "c" && !busy) exit();
    },
  });

  // Fetch the live Codex catalog (memoized for the session). Returns [] on
  // failure after surfacing an error item; the active model still works.
  const loadCodexModels = useCallback(
    async (refresh = false): Promise<CodexModel[]> => {
      const creds = loadStoredConfig().credentials?.["openai-oauth"];
      if (!creds || creds.type !== "openai-oauth") return [];
      const tokens = creds;
      if (!codexCacheRef.current) {
        codexCacheRef.current = new CodexModelCache(() =>
          fetchCodexModels({
            access: tokens.access,
            refresh: tokens.refresh,
            expires: tokens.expires,
            ...(tokens.accountId ? { accountId: tokens.accountId } : {}),
          }),
        );
      }
      try {
        const models = await codexCacheRef.current.get({ refresh });
        setCodexModels(models);
        return models;
      } catch (error) {
        setItems((prev) => [
          ...prev,
          {
            kind: "error",
            text: `Could not fetch ChatGPT models: ${error instanceof Error ? error.message : error}`,
          },
        ]);
        return [];
      }
    },
    [],
  );

  const loadAntigravityModels = useCallback(
    async (refresh = false): Promise<string[]> => {
      const creds = loadStoredConfig().credentials?.antigravity;
      if (!creds || creds.type !== "antigravity") return [];
      if (!antigravityModelsRef.current || refresh) {
        antigravityModelsRef.current = (async () => {
          const provider = getProvider("antigravity", creds);
          await provider.getStatus?.();
          const models = provider.info.availableModels ?? [];
          setAntigravityModels(models);
          return models;
        })().catch((error) => {
          antigravityModelsRef.current = null;
          setItems((prev) => [
            ...prev,
            {
              kind: "error",
              text: `Could not fetch Antigravity models: ${error instanceof Error ? error.message : error}`,
            },
          ]);
          return [];
        });
      }
      return antigravityModelsRef.current;
    },
    [],
  );

  // Fetch the live Codex catalog when the picker opens for openai-oauth, and
  // re-fetch on `/model --refresh`. Memoized for the session by the cache.
  useEffect(() => {
    if (!modelPicker.open || meta.provider !== "openai-oauth") return;
    const refresh = input.slice("/model".length).trim() === "--refresh";
    void loadCodexModels(refresh);
  }, [modelPicker.open, meta.provider, input, loadCodexModels]);

  useEffect(() => {
    if (!modelPicker.open || meta.provider !== "antigravity") return;
    const refresh = input.slice("/model".length).trim() === "--refresh";
    void loadAntigravityModels(refresh);
  }, [modelPicker.open, meta.provider, input, loadAntigravityModels]);

  const applyEffort = useCallback(
    (model: string, effort: string) => {
      try {
        saveReasoningEffort(meta.provider, effort);
        onChangeModel(model);
        setItems((prev) => [
          ...prev,
          {
            kind: "assistant",
            text: `Model changed to ${meta.provider} / ${model} (effort: ${effort})`,
          },
        ]);
      } catch (error) {
        setItems((prev) => [
          ...prev,
          {
            kind: "error",
            text: error instanceof Error ? error.message : "failed to change model",
          },
        ]);
      }
      setEffortPicker(null);
      setSelectedEffortIndex(0);
      setInput("");
    },
    [meta.provider, onChangeModel],
  );

  const selectModel = useCallback(
    (model: string) => {
      const validation = validateModel(meta.provider, model, liveModels);
      if (!validation.ok) {
        setItems((prev) => [...prev, { kind: "error", text: validation.message }]);
        setInput("");
        return;
      }

      const levels =
        meta.provider === "openai-oauth"
          ? effortLevelsFor(codexModels, model)
          : meta.provider === "claude"
            ? claudeEffortLevelsForModel(model)
            : [];
      if (levels.length > 1) {
        const seed =
          getReasoningEffort(loadStoredConfig(), meta.provider) ||
          (meta.provider === "openai-oauth"
            ? defaultEffortFor(codexModels, model)
            : undefined) ||
          levels[0]!;
        const seedIdx = Math.max(0, levels.indexOf(seed));
        setEffortPicker({ model, levels });
        setSelectedEffortIndex(seedIdx);
        setInput("");
        return;
      }

      try {
        onChangeModel(model);
        setItems((prev) => [
          ...prev,
          { kind: "assistant", text: `Model changed to ${meta.provider} / ${model}` },
        ]);
      } catch (error) {
        setItems((prev) => [
          ...prev,
          {
            kind: "error",
            text: error instanceof Error ? error.message : "failed to change model",
          },
        ]);
      }
      setInput("");
    },
    [meta.provider, onChangeModel, liveModels, codexModels],
  );

  const selectTheme = useCallback(
    (themeId: string) => {
      const theme = THEMES.find((candidate) => candidate.id === themeId);
      if (!theme) {
        setItems((prev) => [
          ...prev,
          {
            kind: "error",
            text: `unknown theme: ${themeId}. Use /theme to pick one.`,
          },
        ]);
        setInput("");
        return;
      }

      applyTheme(theme);
      setInput("");
    },
    [applyTheme],
  );

  function toggleInstalledServer(name: string) {
    const cfg = loadStoredConfig();
    const current = cfg.mcp?.[name];
    if (!current) return;
    const next = withMcpServer(cfg, name, {
      ...current,
      enabled: current.enabled === false ? true : false,
    });
    saveStoredConfig(next);
    onMcpConfigChange(next.mcp ?? {});
    setItems((prev) => [
      ...prev,
      {
        kind: "command",
        title: "MCP Updated",
        rows: [
          { label: "server", value: name },
          { label: "enabled", value: next.mcp?.[name]?.enabled === false ? "false" : "true" },
        ],
      },
    ]);
  }

  function removeInstalledServer(name: string) {
    const cfg = loadStoredConfig();
    const next = withoutMcpServer(cfg, name);
    saveStoredConfig(next);
    onMcpConfigChange(next.mcp ?? {});
    setItems((prev) => [
      ...prev,
      {
        kind: "command",
        title: "MCP Removed",
        rows: [{ label: "server", value: name }],
      },
    ]);
  }

  const submit = useCallback(
    async (value: string) => {
      const text = value.trim();
      if (userQuestionRequest) {
        const answer = text || userQuestionRequest.options?.[selectedQuestionOptionIndex] || "";
        if (!answer) return;
        userQuestionRequest.resolve(answer);
        setUserQuestionRequest(null);
        setInput("");
        return;
      }

      if (!text || busy || compacting) return;

      // Registry-backed commands, plus the unknown-command error: slash
      // input never reaches the model. The context is built per dispatch so
      // command handlers always see fresh state (see APP_REFACTOR_PLAN.md).
      if (text.startsWith("/")) {
        setInput("");
        const ctx: CommandContext = {
          agent,
          meta,
          registry: commandRegistry,
          emit: (...newItems) => setItems((prev) => [...prev, ...newItems]),
          setInput,
          state: {
            activeThemeId: activeTheme.id,
            sessionId: sessionIdRef.current,
            taskListId,
            contextStatus,
          },
          ui: {
            openMcpPanel,
            openAgentsPanel,
            triggerSetup: onTriggerSetup,
            triggerResume: onTriggerResume,
            applyTheme: selectTheme,
            selectModel,
            changeModel: onChangeModel,
            exit,
            setContextStatus,
            setCompacting: (on) => {
              setCompacting(on);
              setCompactStartedAt(on ? Date.now() : null);
            },
            setMcpConfig: onMcpConfigChange,
            persistSession,
          },
        };
        await dispatchCommand(text, commandRegistry, ctx);
        return;
      }

      // Splice any stashed large pastes back into the text sent to the model,
      // but keep the compact `[Pasted text #N]` placeholder in the transcript
      // so it stays readable. Clear the stash for the next prompt.
      const expanded = expandPastedRefs(text, pastedContentsRef.current);
      pastedContentsRef.current = {};
      nextPasteIdRef.current = 1;
      setItems((prev) => [...prev, { kind: "user", text }]);
      setInput("");
      await runTurn(expanded);
    },
    [busy, compacting, exit, activeTheme.id, onTriggerSetup, onTriggerResume, selectModel, selectTheme, runTurn, userQuestionRequest, selectedQuestionOptionIndex, setUserQuestionRequest, agent, meta, contextStatus, taskListId, openMcpPanel, commandRegistry, onChangeModel, onMcpConfigChange, persistSession],
  );
  const streamingPreview = streaming;
  const messageWidth = Math.max(32, terminalSize.width - 4);
  // Content width inside the bordered input frame: the frame consumes 4 more
  // columns (left/right border + paddingX) on top of the root's paddingX.
  // Sizing the inner content to messageWidth instead pushes the right border
  // past the terminal edge and the frame renders open-ended.
  const inputWidth = Math.max(24, terminalSize.width - 8);

  // Claude Code's approach: the live streaming reply / thinking indicator /
  // empty-state hint ride INSIDE the virtualized list as transient items, not
  // as a separate footer node below the ScrollBox. They are rebuilt every
  // render and never appended to the committed `items` state. Keeping the
  // ScrollBox content a flat [spacer, ...items, spacer] is what
  // useVirtualScroll's spacer/sticky/cull math assumes — a variable-height
  // footer outside that shape grew on every token and broke scroll.
  const displayItems = useMemo<Item[]>(() => {
    if (items.length === 1 && items[0]?.kind === "intro" && !busy) {
      return [
        ...items,
        {
          kind: "hint",
          text: "Describe a task, or type / for commands.",
        },
      ];
    }
    if (compacting) {
      return [
        ...items,
        { kind: "thinking", elapsedSeconds, frame: activityFrame, label: "compacting" },
      ];
    }
    if (busy && !approvalRequest && !userQuestionRequest) {
      return [
        ...items,
        streamingPreview
          ? { kind: "streaming", text: streamingPreview }
          : { kind: "thinking", elapsedSeconds, frame: activityFrame, reasoning },
      ];
    }
    return items;
  }, [
    items,
    busy,
    compacting,
    approvalRequest,
    userQuestionRequest,
    streamingPreview,
    elapsedSeconds,
    activityFrame,
    reasoning,
  ]);

  // The transcript ScrollBox uses flexGrow={1}, so it yields height to whatever
  // overlay (picker/approval/menu) opens below it automatically — no manual row
  // budgeting needed (unlike the old fixed-height ScrollViewport).

  const handleInputChange = useCallback((next: string) => {
    // If the user edited away a `[Pasted text #N]` placeholder, drop the
    // matching stashed content so it isn't spliced into a later submit.
    pastedContentsRef.current = pruneOrphanedPastes(next, pastedContentsRef.current);
    setInput(next);
  }, []);
  const handlePaste = useCallback((content: PastedContent) => {
    pastedContentsRef.current = { ...pastedContentsRef.current, [content.id]: content };
  }, []);
  const allocatePasteId = useCallback(() => nextPasteIdRef.current++, []);

  // Prompts already sent this session (oldest first), for arrow-up recall.
  const promptHistory = useMemo(
    () => items.filter((item) => item.kind === "user").map((item) => (item as { text: string }).text),
    [items],
  );
  // Recall must never collide with a picker/menu that owns the arrow keys.
  // (anyModalActive also covers the MCP/agents panels; while those are open
  // ChatInput is inactive anyway, so the gate is equivalent to the old list.)
  const historyEnabled = !anyModalActive;

  const chatInput = (
    <ChatInput
      value={input}
      onChange={handleInputChange}
      onSubmit={submit}
      onPaste={handlePaste}
      nextPasteId={allocatePasteId}
      width={inputWidth}
      active={!mcpPanelOpen && !agentsPanelOpen}
      history={promptHistory}
      historyEnabled={historyEnabled}
      submitEnabled={
        !mcpPanelOpen &&
        !agentsPanelOpen &&
        !modelPicker.open &&
        !themePicker.open &&
        // Block submit only while the slash menu still has a pending
        // completion. Once the text is an exact command name (e.g.
        // "/sessions"), Enter must submit so the command can run.
        !(
          showSlashMenu &&
          filteredCommands.length > 0 &&
          !filteredCommands.some((cmd) => cmd.name === input)
        ) &&
        !approvalRequest &&
        (!busy || Boolean(userQuestionRequest))
      }
    />
  );

  return (
    <Box flexDirection="column" width="100%" paddingX={1} paddingY={0}>
      {/* Plain growing transcript (no ScrollBox). The app renders into the
          terminal's NORMAL screen, so finalized rows scroll into native
          scrollback and the terminal owns scrolling. The live streaming reply /
          thinking indicator / empty-state hint ride INSIDE `displayItems` as
          transient items, so the still-streaming tail redraws in place while
          everything above it stays in scrollback. */}
      <TranscriptList
        items={displayItems}
        width={messageWidth}
        theme={activeTheme}
        provider={meta.provider}
        model={meta.model}
        activityFrame={activityFrame}
      />

      {/* Bottom chrome: pickers/overlays, the prompt input frame, the slash
          menu and the status footer. It stacks directly under the transcript;
          as the transcript grows, the whole column grows and older rows scroll
          into the terminal's scrollback. */}
      <Box flexDirection="column" flexShrink={0} width="100%">
      <TaskPanel tasks={tasks} theme={activeTheme} width={messageWidth} />
      <AgentUsagePanel usage={agentUsage} theme={activeTheme} width={messageWidth} />
      {effortPicker ? (
        <Box
          flexDirection="column"
          paddingLeft={2}
          marginBottom={1}
          width="100%"
        >
          <Text bold color={activeTheme.accent}>
            Reasoning effort <Text color={activeTheme.muted}>· {effortPicker.model}</Text>
          </Text>
          <Box flexDirection="column" marginTop={1}>
            {effortPicker.levels.map((level, idx) => (
              <Box key={level} flexDirection="row">
                <Text color={idx === selectedEffortIndex ? activeTheme.accent : "gray"}>
                  {idx === selectedEffortIndex ? "❯ " : "  "}
                </Text>
                <Text color={idx === selectedEffortIndex ? activeTheme.primary : "white"}>
                  {level}
                </Text>
              </Box>
            ))}
          </Box>
          <PickerHint theme={activeTheme} />
        </Box>
      ) : modelPicker.open ? (
        <Box
          flexDirection="column"
          paddingLeft={2}
          marginBottom={1}
          width="100%"
        >
          <Text bold color={activeTheme.accent}>
            Select model <Text color={activeTheme.muted}>· {PROVIDER_CATALOG[meta.provider].displayName}</Text>
          </Text>
          <Box flexDirection="column" marginTop={1}>
            {modelPicker.items.length > 0 ? (
              modelPicker.items.map((model, idx) => (
                <Box key={model} flexDirection="row">
                  <Text color={idx === selectedModelIndex ? activeTheme.accent : "gray"}>
                    {idx === selectedModelIndex ? "❯ " : "  "}
                  </Text>
                  <Text bold={model === meta.model} color={idx === selectedModelIndex ? activeTheme.primary : "white"}>
                    {model === meta.model ? "★ " : "  "}
                    {meta.provider === "antigravity" ? antigravityModelLabel(model) : model}
                    {meta.provider === "antigravity" ? <Text color={activeTheme.muted}> {" · "}{model}</Text> : null}
                  </Text>
                </Box>
              ))
            ) : (
              <Text color={activeTheme.warning}>No matching model. Type /model {"<model-id>"}.</Text>
            )}
          </Box>
          <PickerHint theme={activeTheme} />
        </Box>
      ) : themePicker.open ? (
        <Box
          flexDirection="column"
          paddingLeft={2}
          marginBottom={1}
          width="100%"
        >
          <Text bold color={activeTheme.accent}>Interface theme</Text>
          <Box flexDirection="column" marginTop={1}>
            {themePicker.items.length > 0 ? (
              themePicker.items.map((theme, idx) => (
                <Box key={theme.id} flexDirection="row">
                  <Text color={idx === selectedThemeIndex ? activeTheme.accent : "gray"}>
                    {idx === selectedThemeIndex ? "❯ " : "  "}
                  </Text>
                  <Text bold={theme.id === activeTheme.id} color={idx === selectedThemeIndex ? activeTheme.primary : "white"}>
                    {theme.id === activeTheme.id ? "★ " : "  "}
                    {theme.id.padEnd(12)}
                  </Text>
                  <Text color={idx === selectedThemeIndex ? "white" : activeTheme.muted}>
                    {theme.name}
                  </Text>
                </Box>
              ))
            ) : (
              <Text color={activeTheme.warning}>No matching theme. Type /theme.</Text>
            )}
          </Box>
          <PickerHint theme={activeTheme} />
        </Box>
      ) : mcpPanelOpen ? (
        <McpPanel
          theme={activeTheme}
          width={messageWidth}
          tab={mcpPanelTab}
          installedRows={installedMcpRows}
          selectedInstalledIndex={selectedInstalledMcpIndex}
          query={mcpPanelQuery}
          results={mcpPanelResults}
          selectedSearchIndex={selectedSearchMcpIndex}
          loading={mcpPanelLoading}
          error={mcpPanelError}
        />
      ) : agentsPanelOpen ? (
        <AgentsPanel
          theme={activeTheme}
          width={messageWidth}
          view={agentsView}
          profiles={agentProfiles}
          selectedIndex={selectedAgentIndex}
          draft={agentDraft}
          fieldIndex={agentFieldIndex}
          loggedInProviders={loggedInProviders}
          error={agentsPanelError}
        />
      ) : null}

      {/* Input frame: a single rounded border instead of full-width rules.
          The border doubles as a live status cue — accent while a turn is
          running, muted when idle — so the UI reads as active without extra
          chrome. */}
      <Box
        flexDirection="column"
        width={terminalSize.width - 2}
        marginTop={1}
        borderStyle="round"
        borderColor={busy || compacting ? activeTheme.accent : activeTheme.muted}
        paddingX={1}
      >
        {approvalRequest ? (
          // Permission prompt lives inside the input frame, which grows to
          // fit it — the same place the user would otherwise be typing.
          <ApprovalRequestView
            request={approvalRequest}
            selectedIndex={selectedApprovalIndex}
            options={approvalOptions}
            theme={activeTheme}
            width={inputWidth}
          />
        ) : userQuestionRequest ? (
          <Box flexDirection="column">
            <UserQuestionRequestView
              request={userQuestionRequest}
              selectedIndex={selectedQuestionOptionIndex}
              theme={activeTheme}
              width={inputWidth}
            />
            {(userQuestionRequest.allowFreeText ?? true) ? (
              <Box marginTop={1}>{chatInput}</Box>
            ) : null}
          </Box>
        ) : (
          chatInput
        )}
      </Box>

      {/* Slash-command menu sits just below the prompt (Claude Code style). */}
      {showSlashMenu && filteredCommands.length > 0 ? (
        <Box flexDirection="column" paddingLeft={2} marginTop={1} width="100%">
          {filteredCommands.map((cmd, idx) => (
            <Box key={cmd.name} flexDirection="row">
              <Text color={idx === selectedCommandIndex ? activeTheme.accent : "gray"}>
                {idx === selectedCommandIndex ? "❯ " : "  "}
              </Text>
              <Text bold color={idx === selectedCommandIndex ? activeTheme.primary : "white"}>
                {cmd.name.padEnd(12)}
              </Text>
              <Text color={idx === selectedCommandIndex ? "white" : activeTheme.muted}>
                {cmd.desc}
              </Text>
            </Box>
          ))}
        </Box>
      ) : null}

      {/* Status bar: one clipped row bounded to the same content width as the
          rules above (terminal width minus the root's paddingX). The left side
          keeps its natural width (flexShrink=0); a flexGrow spacer pushes the
          right side to the edge; the right side truncates instead of spilling
          past the terminal. Matches Claude Code's footer (overflow:hidden row +
          wrap="truncate"), so nothing ever overflows on resize. */}
      <Box width={terminalSize.width - 2} marginTop={1} overflow="hidden">
        <Box flexDirection="row" gap={1} flexShrink={0}>
          {permissionMode === "acceptEdits" ? (
            <Text color={activeTheme.success} bold>
              ⏵⏵ accept edits on{" "}
              <Text color={activeTheme.muted} dimColor>
                (shift+tab to cycle)
              </Text>
            </Text>
          ) : (
            <Text color={activeTheme.muted} dimColor>
              shift+tab: accept edits
            </Text>
          )}
        </Box>
        <Box flexGrow={1} />
        <Box flexDirection="row" gap={1} flexShrink={1}>
          {items.length > 1 ? (
            <Text color={activeTheme.muted} dimColor wrap="truncate">
              scroll to view history{"  "}
            </Text>
          ) : null}
          <Text color={activeTheme.muted} dimColor wrap="truncate">
            {formatStatusFooter(contextStatus, {
              ...(footerEffort ? { effort: footerEffort } : {}),
              ...(footerThinking ? { thinking: footerThinking } : {}),
            })}
          </Text>
        </Box>
      </Box>
      </Box>
    </Box>
  );
}

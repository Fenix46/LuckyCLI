import { Box, Text, useApp, useWindowSize } from "../vendor/ink-compat.js";
import React, { useCallback, useState, useEffect, useRef, useMemo } from "react";
import {
  PROVIDER_CATALOG,
  type Agent,
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
  discoverSkills,
  effortLevelsFor,
  fetchCodexModels,
  fetchOllamaModels,
  fetchOpencodeZenModels,
  fetchOpenRouterModels,
  getProvider,
  getAutoUpdatePolicy,
  getReasoningEffort,
  getActiveTaskListId,
  getThinkingEnabled,
  listTasks,
  loadStoredConfig,
  onTasksUpdated,
  saveReasoningEffort,
  saveSession,
  saveStoredConfig,
  type SkillActivator,
  type CodexModel,
  type Task,
} from "@luckycli/core";
import { applyUpdateNow, checkForUpdate, updateRows } from "../update.js";
import { THEMES, themeById, type Theme } from "./themes.js";
import type { Item, CommandRow } from "./lib/items.js";
import { messagesToItems, patchLastTool } from "./lib/items.js";
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
import {
  buildTurnContent,
  formatImageRef,
  loadImage,
  pruneOrphanedImages,
  type AttachedImages,
} from "./lib/image-input.js";
import { formatStatusFooter } from "./lib/status.js";
import { buildCommandRegistry, dispatchCommand, slashMenuEntries } from "./commands/registry.js";
import type { CommandContext } from "./commands/types.js";
import { useAgentsPanel } from "./hooks/useAgentsPanel.js";
import { useElapsedTimer } from "./hooks/useElapsedTimer.js";
import { useStableActivity } from "./hooks/useStableActivity.js";
import { useMcpPanel } from "./hooks/useMcpPanel.js";
import { useSkillPanel } from "./hooks/useSkillPanel.js";
import { useModalRouter, type ModalHandler } from "./hooks/useModalRouter.js";
import { useTurnRunner } from "./hooks/useTurnRunner.js";
import { APP_VERSION } from "./components/constants.js";
import { ChatInput } from "./components/ChatInput.js";
import { PickerHint } from "./components/PickerHint.js";
import { TaskPanel } from "./components/TaskPanel.js";
import { AgentUsagePanel } from "./components/AgentUsagePanel.js";
import { TranscriptList } from "./components/Transcript.js";
import { ActivityIndicator } from "./components/ActivityIndicator.js";
import { McpPanel } from "./components/McpPanel.js";
import { SkillPanel } from "./components/SkillPanel.js";
import { AgentsPanel } from "./components/AgentsPanel.js";
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
  /** Session skill activator, shared with the agent (skill_load marks active). */
  skillActivator: SkillActivator;
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
  skillActivator,
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
  // Ctrl+O toggles the task panel between the compact rolling window and the
  // full list. Off by default so a long plan never floods the screen.
  const [tasksExpanded, setTasksExpanded] = useState(false);
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
  // Images dropped/pasted into the prompt, stashed behind `[Image #N]`
  // placeholders and expanded into ImageParts at submit (see image-input.ts).
  const attachedImagesRef = useRef<AttachedImages>({});
  const nextImageIdRef = useRef<number>(1);
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
    skills: skillActivator,
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

  // Installed+enabled skills become direct `/<name>` commands. Discovered once
  // at mount (best-effort); installing mid-session is still usable via
  // `/skill use`. A changed list rebuilds the registry below.
  const [skillCommandNames, setSkillCommandNames] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    discoverSkills()
      .then((skills) => {
        if (cancelled) return;
        setSkillCommandNames(skills.filter((s) => s.enabled).map((s) => s.name));
      })
      .catch(() => {
        /* no skills dir, or unreadable — leave the list empty */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Slash commands: registry derived from the static set plus skill aliases;
  // per-dispatch state travels in the CommandContext. The menu and /help derive
  // from the same list.
  const commandRegistry = useMemo(
    () => buildCommandRegistry(skillCommandNames),
    [skillCommandNames],
  );
  const menuEntries = useMemo(() => slashMenuEntries(commandRegistry), [commandRegistry]);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const showSlashMenu = input.startsWith("/");
  const filteredCommands = menuEntries.filter((cmd) =>
    cmd.name.startsWith(input)
  );
  // Panel state machines (state + keys + actions) live in their hooks; App
  // keeps the open() calls, the modal-chain slots and the render slots.
  const mcpPanel = useMcpPanel({
    mcpConfig,
    mcpStatus: mcpManager?.status() ?? {},
    onMcpConfigChange,
    emit: (item) => setItems((prev) => [...prev, item]),
  });
  const skillPanel = useSkillPanel({
    emit: (item) => setItems((prev) => [...prev, item]),
  });
  const agentsPanel = useAgentsPanel();
  // Live Codex model catalog (openai-oauth only), fetched on demand and cached
  // for the session. The picker reads these slugs instead of a hardcoded list.
  const codexCacheRef = useRef<CodexModelCache | null>(null);
  const [codexModels, setCodexModels] = useState<CodexModel[]>([]);
  const antigravityModelsRef = useRef<Promise<string[]> | null>(null);
  const [antigravityModels, setAntigravityModels] = useState<string[]>([]);
  // Installed Ollama models, discovered from the daemon (/api/tags).
  const ollamaModelsRef = useRef<Promise<string[]> | null>(null);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  // Live gateway catalogs, fetched when the /model picker opens.
  const zenModelsRef = useRef<Promise<string[]> | null>(null);
  const [zenModels, setZenModels] = useState<string[]>([]);
  const openRouterModelsRef = useRef<Promise<string[]> | null>(null);
  const [openRouterModels, setOpenRouterModels] = useState<string[]>([]);
  const liveModels =
    meta.provider === "openai-oauth"
      ? codexModels.map((m) => m.slug)
      : meta.provider === "antigravity"
        ? antigravityModels
        : meta.provider === "ollama"
          ? ollamaModels
          : meta.provider === "opencode-zen"
            ? zenModels
            : meta.provider === "openrouter"
              ? openRouterModels
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
    // 2.5 MCP control panel
    mcpPanel.handler,
    // 2.55 Skills (/skill) control panel
    skillPanel.handler,
    // 2.6 Sub-agents (/agents) control panel
    agentsPanel.handler,
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
      // Ctrl+O toggles the expanded task view (Claude Code's expand shortcut).
      // Only meaningful when there's a task list to expand.
      if (key.ctrl && _in === "o" && tasks.length > 0) {
        setTasksExpanded((prev) => !prev);
        return;
      }
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

  // Discover installed Ollama models when the picker opens. Returns [] if the
  // daemon is unreachable; the active model still works (validation is lenient).
  const loadOllamaModels = useCallback(
    async (refresh = false): Promise<string[]> => {
      const creds = loadStoredConfig().credentials?.ollama;
      if (!creds || creds.type !== "ollama") return [];
      if (!ollamaModelsRef.current || refresh) {
        ollamaModelsRef.current = fetchOllamaModels(creds.baseUrl)
          .then((models) => {
            const ids = models.map((m) => m.id);
            setOllamaModels(ids);
            return ids;
          })
          .catch(() => {
            ollamaModelsRef.current = null;
            return [];
          });
      }
      return ollamaModelsRef.current;
    },
    [],
  );

  // Fetch the live opencode Zen catalog when the picker opens. Falls back to the
  // public key in core when no key is stored. Returns [] if unreachable.
  const loadZenModels = useCallback(
    async (refresh = false): Promise<string[]> => {
      const creds = loadStoredConfig().credentials?.["opencode-zen"];
      if (!creds || creds.type !== "opencode-zen") return [];
      if (!zenModelsRef.current || refresh) {
        zenModelsRef.current = fetchOpencodeZenModels(creds.apiKey)
          .then((models) => {
            const ids = models.map((m) => m.id);
            setZenModels(ids);
            return ids;
          })
          .catch(() => {
            zenModelsRef.current = null;
            return [];
          });
      }
      return zenModelsRef.current;
    },
    [],
  );

  // Fetch the live OpenRouter catalog when the picker opens. Returns [] if
  // unreachable; the active model still works (validation is lenient).
  const loadOpenRouterModels = useCallback(
    async (refresh = false): Promise<string[]> => {
      const creds = loadStoredConfig().credentials?.openrouter;
      if (!creds || creds.type !== "openrouter") return [];
      if (!openRouterModelsRef.current || refresh) {
        openRouterModelsRef.current = fetchOpenRouterModels(creds.apiKey)
          .then((models) => {
            const ids = models.map((m) => m.id);
            setOpenRouterModels(ids);
            return ids;
          })
          .catch(() => {
            openRouterModelsRef.current = null;
            return [];
          });
      }
      return openRouterModelsRef.current;
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

  useEffect(() => {
    if (!modelPicker.open || meta.provider !== "ollama") return;
    const refresh = input.slice("/model".length).trim() === "--refresh";
    void loadOllamaModels(refresh);
  }, [modelPicker.open, meta.provider, input, loadOllamaModels]);

  useEffect(() => {
    if (!modelPicker.open || meta.provider !== "opencode-zen") return;
    const refresh = input.slice("/model".length).trim() === "--refresh";
    void loadZenModels(refresh);
  }, [modelPicker.open, meta.provider, input, loadZenModels]);

  useEffect(() => {
    if (!modelPicker.open || meta.provider !== "openrouter") return;
    const refresh = input.slice("/model".length).trim() === "--refresh";
    void loadOpenRouterModels(refresh);
  }, [modelPicker.open, meta.provider, input, loadOpenRouterModels]);

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
            openMcpPanel: mcpPanel.open,
            openSkillPanel: skillPanel.open,
            openAgentsPanel: agentsPanel.open,
            runSkill: async (name: string) => {
              // Load the named skill on demand and send its block as a turn so
              // the model applies it to the current work. The transcript shows a
              // compact note; the full body goes to the model, not the screen.
              const block = await skillActivator.activate(name);
              if (!block) return false;
              setItems((prev) => [
                ...prev,
                { kind: "command", title: "Skill loaded", rows: [{ label: "skill", value: name }] },
              ]);
              await runTurn(block);
              return true;
            },
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
      // Expand `[Image #N]` placeholders into ImageParts; a turn with no images
      // collapses back to a plain string. Clear the stash for the next prompt.
      const content = buildTurnContent(expanded, attachedImagesRef.current);
      attachedImagesRef.current = {};
      nextImageIdRef.current = 1;
      setItems((prev) => [...prev, { kind: "user", text }]);
      setInput("");
      await runTurn(content);
    },
    [busy, compacting, exit, activeTheme.id, onTriggerSetup, onTriggerResume, selectModel, selectTheme, runTurn, userQuestionRequest, selectedQuestionOptionIndex, setUserQuestionRequest, agent, meta, contextStatus, taskListId, mcpPanel.open, skillPanel.open, agentsPanel.open, commandRegistry, onChangeModel, onMcpConfigChange, persistSession, skillActivator],
  );
  const streamingPreview = streaming;
  // Hold the streaming/thinking phase for a minimum window so the brief gaps in
  // a turn (a tool call committing the narration block, a silent pause between
  // deltas) don't make the "lucky thinking" header flicker or appear to stall.
  const { phase: activityPhase } = useStableActivity(busy, streamingPreview.length > 0);
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
    // The live streaming reply still rides at the tail of the transcript so it
    // grows in place. The "working" indicator is NO LONGER a transcript item —
    // it's fixed chrome above the input frame (see ActivityIndicator below), so
    // it stays visible regardless of how far the transcript has scrolled and
    // never appears to stall behind a tool result or the task panel.
    if (busy && !compacting && !approvalRequest && !userQuestionRequest && streamingPreview) {
      return [...items, { kind: "streaming", text: streamingPreview }];
    }
    return items;
  }, [
    items,
    busy,
    compacting,
    approvalRequest,
    userQuestionRequest,
    streamingPreview,
  ]);

  // The transcript ScrollBox uses flexGrow={1}, so it yields height to whatever
  // overlay (picker/approval/menu) opens below it automatically — no manual row
  // budgeting needed (unlike the old fixed-height ScrollViewport).

  const handleInputChange = useCallback((next: string) => {
    // If the user edited away a `[Pasted text #N]` or `[Image #N]` placeholder,
    // drop the matching stash so it isn't spliced into a later submit.
    pastedContentsRef.current = pruneOrphanedPastes(next, pastedContentsRef.current);
    attachedImagesRef.current = pruneOrphanedImages(next, attachedImagesRef.current);
    setInput(next);
  }, []);
  const handlePaste = useCallback((content: PastedContent) => {
    pastedContentsRef.current = { ...pastedContentsRef.current, [content.id]: content };
  }, []);
  const allocatePasteId = useCallback(() => nextPasteIdRef.current++, []);

  // Load dropped/pasted image paths, stash them, and return the placeholder
  // text to insert. Unreadable/unsupported files surface as an error item and
  // are skipped, so a bad path never silently disappears.
  const handleAttachImages = useCallback(
    (paths: string[]): string => {
      const placeholders: string[] = [];
      for (const path of paths) {
        const id = nextImageIdRef.current;
        try {
          attachedImagesRef.current = {
            ...attachedImagesRef.current,
            [id]: loadImage(path, id),
          };
          placeholders.push(formatImageRef(id));
          nextImageIdRef.current += 1;
        } catch (err) {
          setItems((prev) => [
            ...prev,
            { kind: "error", text: `Could not attach image ${path}: ${(err as Error).message}` },
          ]);
        }
      }
      return placeholders.join(" ");
    },
    [],
  );

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
      onAttachImages={handleAttachImages}
      nextPasteId={allocatePasteId}
      width={inputWidth}
      active={!mcpPanel.isOpen && !skillPanel.isOpen && !agentsPanel.isOpen}
      history={promptHistory}
      historyEnabled={historyEnabled}
      submitEnabled={
        !mcpPanel.isOpen &&
        !skillPanel.isOpen &&
        !agentsPanel.isOpen &&
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
      <TaskPanel tasks={tasks} theme={activeTheme} width={messageWidth} expanded={tasksExpanded} />
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
      ) : mcpPanel.isOpen ? (
        <McpPanel theme={activeTheme} width={messageWidth} {...mcpPanel.panelProps} />
      ) : skillPanel.isOpen ? (
        <SkillPanel theme={activeTheme} width={messageWidth} {...skillPanel.panelProps} />
      ) : agentsPanel.isOpen ? (
        <AgentsPanel theme={activeTheme} width={messageWidth} {...agentsPanel.panelProps} />
      ) : null}

      {/* Persistent "working" indicator, fixed here above the input frame so it
          stays visible for the whole turn no matter what the model is doing.
          Hidden while the user must act (approval / question) — then they're
          not waiting on the model. */}
      {(busy || compacting) && !approvalRequest && !userQuestionRequest ? (
        <ActivityIndicator
          theme={activeTheme}
          elapsedSeconds={elapsedSeconds}
          frame={activityFrame}
          phase={
            activityPhase === "streaming"
              ? "responding"
              : reasoning
                ? "reasoning"
                : "thinking"
          }
          {...(compacting ? { label: "compacting" } : {})}
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

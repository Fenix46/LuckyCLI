import { Box, Text, useApp, useInput, useWindowSize } from "../vendor/ink-compat.js";
import React, { useCallback, useState, useEffect, useRef } from "react";
import {
  CachedMcpCatalog,
  OfficialMcpRegistryCatalog,
  PROVIDER_CATALOG,
  catalogDetailToPreset,
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
  CodexModelCache,
  antigravityModelLabel,
  buildAndSaveGraph,
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
  getThinkingEnabled,
  listSessions,
  loadStoredConfig,
  recordGraphBuilt,
  saveReasoningEffort,
  saveThinkingEnabled,
  saveSession,
  saveStoredConfig,
  withAutoUpdatePolicy,
  withMcpServer,
  withoutMcpServer,
  type CodexModel,
} from "@luckycli/core";
import { applyUpdateNow, checkForUpdate, stageUpdate, updateRows } from "../update.js";
import { THEMES, themeById, type Theme } from "./themes.js";
import type { Item, CommandRow } from "./lib/items.js";
import { messagesToItems, patchLastTool } from "./lib/items.js";
import { buildInstalledMcpRows } from "./lib/mcp-rows.js";
import {
  getModelPickerState,
  getThemePickerState,
  getAvailableModels,
  validateModel,
} from "./lib/model-picker.js";
import { formatNumber } from "./lib/format.js";
import {
  contextRows,
  formatStatusFooter,
} from "./lib/status.js";
import { useElapsedTimer } from "./hooks/useElapsedTimer.js";
import { useTurnRunner } from "./hooks/useTurnRunner.js";
import { APP_VERSION } from "./components/constants.js";
import { ThinkingStatus } from "./components/ThinkingStatus.js";
import { StreamingPreview } from "./components/StreamingPreview.js";
import { ChatInput } from "./components/ChatInput.js";
import { PickerHint } from "./components/PickerHint.js";
import { VirtualTranscript } from "./components/VirtualTranscript.js";
import type { ScrollBoxHandle } from "../vendor/ink/components/ScrollBox.js";
import { McpPanel, type McpPanelTab } from "./components/McpPanel.js";
import { ApprovalRequestView } from "./components/Approval.js";
import { UserQuestionRequestView } from "./components/UserQuestion.js";
import type {
  ApprovalRequest,
  UserQuestionRequest,
  PermissionMode,
} from "./lib/requests.js";

interface AppMeta {
  provider: ProviderId;
  model: string;
}

export type {
  ApprovalRequest,
  UserQuestionRequest,
  PermissionMode,
} from "./lib/requests.js";

interface AppProps {
  agent: Agent;
  meta: AppMeta;
  approvalRequest: ApprovalRequest | null;
  setApprovalRequest: (req: ApprovalRequest | null) => void;
  userQuestionRequest: UserQuestionRequest | null;
  setUserQuestionRequest: (req: UserQuestionRequest | null) => void;
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

/**
 * Rows reserved at the bottom for the input frame and status line (two rule
 * lines, the prompt, the footer, and margins). The transcript viewport gets the
 * remaining terminal height.
 */
const CHROME_ROWS = 8;

const ALL_SLASH_COMMANDS = [
  { name: "/model", desc: "Switch model for the active provider" },
  { name: "/thinking", desc: "Toggle Claude adaptive thinking (/thinking on|off)" },
  { name: "/mcp", desc: "Open the interactive MCP control panel" },
  { name: "/status", desc: "Show provider auth, account, quota and context status" },
  { name: "/update", desc: "Check for updates (/update apply, /update auto <mode>)" },
  { name: "/compact", desc: "Summarize older chat history now" },
  { name: "/resume", desc: "Pick a saved session to resume" },
  { name: "/provider", desc: "Switch provider and authenticate" },
  { name: "/theme", desc: "Choose terminal UI colors" },
  { name: "/graph", desc: "Build/refresh the project knowledge graph" },
  { name: "/exit", desc: "Exit the lucky agent session" },
];

export function App({
  agent,
  meta,
  approvalRequest,
  setApprovalRequest,
  userQuestionRequest,
  setUserQuestionRequest,
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

  // The vendored ScrollBox owns scroll position imperatively (scrollTop lives on
  // its DOM node, not in React state) — that's what keeps scrolling smooth on a
  // long chat. We drive it through this handle and read nothing back per frame.
  const scrollRef = useRef<ScrollBoxHandle | null>(null);

  const appendItems = useCallback(
    (next: Item[]) => {
      // New content arrived: snap back to the bottom so it's visible.
      scrollRef.current?.scrollToBottom();
      setItems((prev) => [...prev, ...next]);
    },
    [],
  );
  const patchTool = useCallback(
    (name: string, output: string, error: boolean) =>
      setItems((prev) => patchLastTool(prev, name, output, error)),
    [],
  );
  const onUsage = useCallback((_usage: TokenUsage) => {}, []);
  const { busy, startedAt, streaming, abort, runTurn } = useTurnRunner({
    agent,
    appendItems,
    patchTool,
    onContext: setContextStatus,
    onUsage,
    persist: persistSession,
  });
  const { elapsedSeconds, activityFrame } = useElapsedTimer(busy, startedAt);

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

        // "auto": download + verify in the background and stage it; the next
        // launch applies it. We never swap the binary under a live session.
        if (policy === "auto" && info.latestVersion && detectSelfUpdate().ok) {
          try {
            const staged = await stageUpdate(info.latestVersion);
            if (!cancelled && staged) {
              setItems((prev) => [
                ...prev,
                {
                  kind: "command",
                  title: "Update Ready",
                  rows: [
                    { label: "version", value: info.latestVersion! },
                    { label: "status", value: "downloaded — applies on next launch" },
                  ],
                },
              ]);
              return;
            }
          } catch {
            // Staging is best-effort; fall through to the notify banner.
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

  // Slash commands navigation
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const showSlashMenu = input.startsWith("/");
  const filteredCommands = ALL_SLASH_COMMANDS.filter((cmd) =>
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

  // Ctrl+C exits when idle. Support autocomplete and tool approval.
  useInput((_in, key) => {
    // 0. Shift+Tab cycles the session permission mode. Intercept it before any
    // other branch so it never triggers a plain-Tab action (option cycling,
    // slash-command completion). Ignore it while a modal/picker owns the keys.
    if (key.tab && key.shift) {
      const modalActive =
        Boolean(approvalRequest) ||
        Boolean(userQuestionRequest) ||
        mcpPanelOpen ||
        modelPicker.open ||
        Boolean(effortPicker) ||
        themePicker.open ||
        showSlashMenu;
      if (!modalActive) onCyclePermissionMode();
      return;
    }

    // 0b. PageUp/PageDown scroll the transcript viewport. Safe to handle even
    // while typing — text input never produces these keys. A page is most of
    // the viewport height.
    if (key.pageUp || key.pageDown) {
      const page = Math.max(1, terminalSize.height - CHROME_ROWS - 1);
      scrollRef.current?.scrollBy(key.pageUp ? -page : page);
      return;
    }

    // 0c. Mouse wheel. The vendored fork surfaces wheel ticks as key events
    // (key.wheelUp/wheelDown), routed here so we scroll the transcript instead
    // of leaking "<64;..M" into the prompt. One line per tick; up reveals older.
    if (key.wheelUp || key.wheelDown) {
      scrollRef.current?.scrollBy(key.wheelUp ? -1 : 1);
      return;
    }

    // 1. Tool safety approval has highest precedence
    if (approvalRequest) {
      if (key.ctrl && _in === "c") {
        approvalRequest.resolve("deny");
        setApprovalRequest(null);
        abort();
        return;
      }
      if (key.leftArrow || key.upArrow || _in === "h" || _in === "k") {
        setSelectedApprovalIndex(
          (prev) => (prev - 1 + approvalOptions.length) % approvalOptions.length,
        );
        return;
      }
      if (key.rightArrow || key.downArrow || _in === "l" || _in === "j" || key.tab) {
        setSelectedApprovalIndex((prev) => (prev + 1) % approvalOptions.length);
        return;
      }
      if (key.return) {
        const decision = approvalOptions[selectedApprovalIndex] ?? "deny";
        approvalRequest.resolve(decision);
        setApprovalRequest(null);
        // Refusing a tool stops the whole turn, like Esc — the model does not
        // get to react to the denial and keep working.
        if (decision === "deny") abort();
        return;
      }
      if (key.escape) {
        approvalRequest.resolve("deny");
        setApprovalRequest(null);
        abort();
      }
      return;
    }

    // 2. User question from ask_user tool
    if (userQuestionRequest) {
      const options = userQuestionRequest.options ?? [];
      if (key.ctrl && _in === "c") {
        userQuestionRequest.resolve("User cancelled the question.");
        setUserQuestionRequest(null);
        abort();
        return;
      }
      if (options.length > 0 && (key.leftArrow || key.upArrow || _in === "h" || _in === "k")) {
        setSelectedQuestionOptionIndex(
          (prev) => (prev - 1 + options.length) % options.length,
        );
        return;
      }
      if (options.length > 0 && (key.rightArrow || key.downArrow || _in === "l" || _in === "j" || key.tab)) {
        setSelectedQuestionOptionIndex((prev) => (prev + 1) % options.length);
        return;
      }
      if (key.return && options.length > 0 && !userQuestionRequest.allowFreeText) {
        userQuestionRequest.resolve(options[selectedQuestionOptionIndex] ?? options[0] ?? "");
        setUserQuestionRequest(null);
        return;
      }
      if (key.escape) {
        userQuestionRequest.resolve("User skipped the question.");
        setUserQuestionRequest(null);
        abort();
        return;
      }
      return;
    }

    // 2.5 MCP control panel
    if (mcpPanelOpen) {
      if (key.escape) {
        setMcpPanelOpen(false);
        setMcpPanelError(null);
        return;
      }
      if (key.leftArrow || key.rightArrow || key.tab) {
        setMcpPanelTab((prev) => (prev === "installed" ? "search" : "installed"));
        return;
      }
      if (mcpPanelTab === "installed") {
        if (installedMcpRows.length > 0 && key.downArrow) {
          setSelectedInstalledMcpIndex((prev) => (prev + 1) % installedMcpRows.length);
          return;
        }
        if (installedMcpRows.length > 0 && key.upArrow) {
          setSelectedInstalledMcpIndex((prev) => (prev - 1 + installedMcpRows.length) % installedMcpRows.length);
          return;
        }
        const selected = installedMcpRows[selectedInstalledMcpIndex];
        if (key.return && selected) {
          toggleInstalledServer(selected.name);
          return;
        }
        if ((_in === "d" || _in === "D") && selected) {
          removeInstalledServer(selected.name);
          return;
        }
        if (_in === "r" || _in === "R") {
          onMcpConfigChange(mcpConfig);
          setItems((prev) => [
            ...prev,
            { kind: "command", title: "MCP Reload", rows: [{ label: "status", value: "reloading configured MCP servers" }] },
          ]);
          return;
        }
        return;
      }
      if (mcpPanelResults.length > 0 && key.downArrow) {
        setSelectedSearchMcpIndex((prev) => (prev + 1) % mcpPanelResults.length);
        return;
      }
      if (mcpPanelResults.length > 0 && key.upArrow) {
        setSelectedSearchMcpIndex((prev) => (prev - 1 + mcpPanelResults.length) % mcpPanelResults.length);
        return;
      }
      if (key.backspace || key.delete) {
        if (mcpPanelQuery.length > 0) setMcpPanelQuery((prev) => prev.slice(0, -1));
        return;
      }
      if (key.return) {
        const selected = mcpPanelResults[selectedSearchMcpIndex];
        if (!selected) return;
        setMcpPanelLoading(true);
        setMcpPanelError(null);
        void installCatalogServerByName(selected.name)
          .then(() => {
            setMcpPanelLoading(false);
            setMcpPanelTab("installed");
            setMcpPanelQuery("");
          })
          .catch((error) => {
            setMcpPanelLoading(false);
            setMcpPanelError(error instanceof Error ? error.message : "failed to add MCP server");
          });
        return;
      }
      if (!key.ctrl && !key.meta && !key.return && _in) {
        setMcpPanelQuery((prev) => prev + _in);
        return;
      }
      return;
    }

    // 3a. Interactive effort picker navigation (second step, provider-specific)
    if (effortPicker) {
      if (key.escape) {
        setEffortPicker(null);
        setSelectedEffortIndex(0);
        return;
      }
      if (effortPicker.levels.length === 0) return;
      if (key.downArrow) {
        setSelectedEffortIndex((prev) => (prev + 1) % effortPicker.levels.length);
        return;
      }
      if (key.upArrow) {
        setSelectedEffortIndex(
          (prev) => (prev - 1 + effortPicker.levels.length) % effortPicker.levels.length,
        );
        return;
      }
      if (key.return) {
        const effort = effortPicker.levels[selectedEffortIndex];
        if (effort) applyEffort(effortPicker.model, effort);
        return;
      }
      return; // swallow other keys while the effort step is open
    }

    // 3. Interactive model picker navigation
    if (modelPicker.open) {
      if (key.escape) {
        setInput("");
        setSelectedModelIndex(0);
        return;
      }
      if (modelPicker.items.length === 0) return;
      if (key.downArrow) {
        setSelectedModelIndex((prev) => (prev + 1) % modelPicker.items.length);
        return;
      }
      if (key.upArrow) {
        setSelectedModelIndex(
          (prev) => (prev - 1 + modelPicker.items.length) % modelPicker.items.length,
        );
        return;
      }
      if (key.return) {
        const selected = modelPicker.items[selectedModelIndex];
        if (selected) selectModel(selected);
        return;
      }
    }

    // 3. Interactive theme picker navigation
    if (themePicker.open) {
      if (key.escape) {
        setInput("");
        setSelectedThemeIndex(0);
        return;
      }
      if (themePicker.items.length === 0) return;
      if (key.downArrow) {
        setSelectedThemeIndex((prev) => (prev + 1) % themePicker.items.length);
        return;
      }
      if (key.upArrow) {
        setSelectedThemeIndex(
          (prev) => (prev - 1 + themePicker.items.length) % themePicker.items.length,
        );
        return;
      }
      if (key.return) {
        const selected = themePicker.items[selectedThemeIndex];
        if (selected) selectTheme(selected.id);
        return;
      }
    }

    // 4. Interactive Slash Commands menu navigation
    if (
      !modelPicker.open &&
      !themePicker.open &&
      showSlashMenu
    ) {
      if (key.escape) {
        setInput("");
        setSelectedCommandIndex(0);
        return;
      }
      if (filteredCommands.length === 0) return;
      if (key.downArrow) {
        setSelectedCommandIndex((prev) => (prev + 1) % filteredCommands.length);
        return;
      }
      if (key.upArrow) {
        setSelectedCommandIndex(
          (prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length,
        );
        return;
      }
      if (key.tab || (key.return && input !== filteredCommands[selectedCommandIndex]?.name)) {
        const completed = filteredCommands[selectedCommandIndex]?.name;
        if (completed) {
          setInput(completed);
          setSelectedCommandIndex(0);
        }
        return;
      }
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

  async function installCatalogServerByName(name: string) {
    const catalog = new CachedMcpCatalog(new OfficialMcpRegistryCatalog());
    const detail = await catalog.get(name);
    const preset = catalogDetailToPreset(detail);
    const cfg = loadStoredConfig();
    const next = withMcpServer(cfg, preset.name, preset.config);
    saveStoredConfig(next);
    onMcpConfigChange(next.mcp ?? {});
    setItems((prev) => [
      ...prev,
      {
        kind: "command",
        title: "MCP Added",
        rows: [
          { label: "server", value: preset.name },
          { label: "type", value: preset.config.type },
          { label: "source", value: "official-registry" },
        ],
      },
    ]);
  }

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

      if (!text || busy) return;

      if (text === "/exit" || text === "/quit") {
        exit();
        return;
      }
      if (text === "/theme" || text.startsWith("/theme ")) {
        const requestedTheme = text.slice("/theme".length).trim();
        if (requestedTheme) {
          selectTheme(requestedTheme);
          return;
        }
        setItems((prev) => [
          ...prev,
          {
            kind: "command",
            title: "Themes",
            rows: THEMES.map((theme) => ({
              label: theme.id === activeTheme.id ? "active" : "theme",
              value: `${theme.id} (${theme.name})`,
            })),
          },
        ]);
        setInput("");
        return;
      }
      if (text === "/sessions") {
        const sessions = listSessions().slice(0, 12);
        setItems((prev) => [
          ...prev,
          {
            kind: "command",
            title: "Sessions",
            rows:
              sessions.length === 0
                ? [{ label: "none", value: "no saved sessions yet" }]
                : sessions.map((s) => ({
                    label: s.id === sessionIdRef.current ? "current" : s.id,
                    value: `${s.messageCount} msgs · ${s.title ?? "(untitled)"}`,
                  })),
          },
        ]);
        setInput("");
        return;
      }
      if (text === "/resume") {
        if (listSessions().length === 0) {
          setItems((prev) => [
            ...prev,
            { kind: "error", text: "no saved sessions to resume" },
          ]);
          setInput("");
          return;
        }
        onTriggerResume();
        setInput("");
        return;
      }
      if (text === "/context") {
        try {
          const status = await agent.contextStatus();
          setContextStatus(status);
          setItems((prev) => [
            ...prev,
            {
              kind: "command",
              title: "Context",
              rows: contextRows(status),
            },
          ]);
        } catch (error) {
          setItems((prev) => [
            ...prev,
            {
              kind: "error",
              text: error instanceof Error ? error.message : "failed to read context status",
            },
          ]);
        }
        setInput("");
        return;
      }
      if (text === "/status") {
        try {
          const [providerStatus, status] = await Promise.all([
            agent.providerStatus(),
            agent.contextStatus(),
          ]);
          setContextStatus(status);
          setItems((prev) => [
            ...prev,
            {
              kind: "status",
              provider: providerStatus,
              context: status,
            },
          ]);
        } catch (error) {
          setItems((prev) => [
            ...prev,
            {
              kind: "error",
              text: error instanceof Error ? error.message : "failed to read provider status",
            },
          ]);
        }
        setInput("");
        return;
      }
      if (text === "/mcp" || text === "/mcp status" || text === "/mcp list") {
        openMcpPanel("installed");
        setInput("");
        return;
      }
      if (text === "/mcp search" || text.startsWith("/mcp search ")) {
        const query = text.slice("/mcp search".length).trim();
        openMcpPanel("search", query);
        setInput("");
        return;
      }
      if (text.startsWith("/mcp show ")) {
        const name = text.slice("/mcp show ".length).trim();
        if (!name) {
          setItems((prev) => [...prev, { kind: "error", text: "usage: /mcp show <server-name>" }]);
          setInput("");
          return;
        }
        try {
          const catalog = new CachedMcpCatalog(new OfficialMcpRegistryCatalog());
          const detail = await catalog.get(name);
          const preset = catalogDetailToPreset(detail);
          setItems((prev) => [
            ...prev,
            {
              kind: "command",
              title: `MCP Server: ${detail.name}`,
              rows: [
                ...(detail.title ? [{ label: "title", value: detail.title }] : []),
                ...(detail.description ? [{ label: "description", value: detail.description }] : []),
                ...(detail.version ? [{ label: "version", value: detail.version }] : []),
                { label: "preset", value: preset.config.type === "local" ? preset.config.command.join(" ") : preset.config.url },
              ],
            },
          ]);
        } catch (error) {
          setItems((prev) => [
            ...prev,
            { kind: "error", text: error instanceof Error ? error.message : "failed to load MCP server" },
          ]);
        }
        setInput("");
        return;
      }
      if (text.startsWith("/mcp add ")) {
        const name = text.slice("/mcp add ".length).trim();
        if (!name) {
          setItems((prev) => [...prev, { kind: "error", text: "usage: /mcp add <server-name>" }]);
          setInput("");
          return;
        }
        try {
          await installCatalogServerByName(name);
        } catch (error) {
          setItems((prev) => [
            ...prev,
            { kind: "error", text: error instanceof Error ? error.message : "failed to add MCP server" },
          ]);
        }
        setInput("");
        return;
      }
      if (text === "/update" || text.startsWith("/update ")) {
        const arg = text.slice("/update".length).trim();
        setInput("");

        // `/update auto <off|notify|auto>`: set the policy in-session.
        if (arg.startsWith("auto")) {
          const policy = arg.slice("auto".length).trim();
          if (policy !== "off" && policy !== "notify" && policy !== "auto") {
            setItems((prev) => [
              ...prev,
              { kind: "error", text: "usage: /update auto <off|notify|auto>" },
            ]);
            return;
          }
          saveStoredConfig(withAutoUpdatePolicy(loadStoredConfig(), policy));
          setItems((prev) => [
            ...prev,
            { kind: "command", title: "Update", rows: [{ label: "policy", value: policy }] },
          ]);
          return;
        }

        try {
          const info = await checkForUpdate(APP_VERSION, { force: true });

          // `/update apply`: download, verify, swap, then exit cleanly. Typing
          // the subcommand is the confirmation; we never swap mid-turn silently.
          if (arg === "apply") {
            if (!info.updateAvailable) {
              setItems((prev) => [
                ...prev,
                { kind: "command", title: "Update", rows: updateRows(info) },
              ]);
              return;
            }
            const result = await applyUpdateNow(undefined);
            if (result.applied) {
              setItems((prev) => [
                ...prev,
                {
                  kind: "command",
                  title: "Updated",
                  rows: [
                    { label: "version", value: info.latestVersion ?? "latest" },
                    { label: "status", value: "installed — restart lucky" },
                  ],
                },
              ]);
              exit();
              return;
            }
            setItems((prev) => [
              ...prev,
              {
                kind: "command",
                title: "Update",
                rows: [
                  { label: "status", value: `cannot self-update (${result.reason})` },
                  ...(result.installCommand
                    ? [{ label: "command", value: result.installCommand }]
                    : []),
                ],
              },
            ]);
            return;
          }

          // Plain `/update`: show status, and how to apply if available.
          const rows = updateRows(info);
          if (info.updateAvailable && detectSelfUpdate().ok) {
            rows.push({ label: "apply", value: "run /update apply to install" });
          }
          setItems((prev) => [
            ...prev,
            {
              kind: "command",
              title: info.updateAvailable ? "Update Available" : "Update",
              rows,
            },
          ]);
        } catch (error) {
          setItems((prev) => [
            ...prev,
            {
              kind: "error",
              text: error instanceof Error ? error.message : "failed to check for updates",
            },
          ]);
        }
        return;
      }
      if (text === "/compact") {
        try {
          const result = await agent.compactNow();
          const status = await agent.contextStatus();
          setContextStatus(status);
          persistSession();
          setItems((prev) => [
            ...prev,
            {
              kind: "command",
              title: "Compaction",
              rows: [
                { label: "removed", value: `${result.removedMessages} messages` },
                { label: "kept", value: `${result.keptMessages} messages` },
                {
                  label: "tokens",
                  value:
                    result.beforeTokens !== undefined && result.afterTokens !== undefined
                      ? `${formatNumber(result.beforeTokens)} -> ${formatNumber(result.afterTokens)}`
                      : "not available",
                },
              ],
            },
          ]);
        } catch (error) {
          setItems((prev) => [
            ...prev,
            {
              kind: "error",
              text: error instanceof Error ? error.message : "failed to compact context",
            },
          ]);
        }
        setInput("");
        return;
      }
      if (text === "/setup" || text === "/provider") {
        setItems((prev) => [
          ...prev,
          {
            kind: "command",
            title: "Provider",
            rows: [{ label: "action", value: "opening provider switcher" }],
          },
        ]);
        onTriggerSetup();
        setInput("");
        return;
      }
      if (text === "/model" || text.startsWith("/model ")) {
        const requestedModel = text.slice("/model".length).trim();
        if (requestedModel) {
          selectModel(requestedModel);
          return;
        }
        setItems((prev) => [
          ...prev,
          {
            kind: "command",
            title: "Models",
            rows: getAvailableModels(meta.provider).map((model) => ({
              label: model === meta.model ? "active" : "model",
              value: model,
            })),
          },
        ]);
        setInput("");
        return;
      }
      if (text === "/thinking" || text === "/thinking on" || text === "/thinking off") {
        if (meta.provider !== "claude") {
          setItems((prev) => [
            ...prev,
            {
              kind: "error",
              text: "/thinking is currently only supported for Claude.",
            },
          ]);
          setInput("");
          return;
        }
        const arg = text.slice("/thinking".length).trim().toLowerCase();
        if (!arg) {
          const enabled = getThinkingEnabled(loadStoredConfig(), meta.provider);
          setItems((prev) => [
            ...prev,
            {
              kind: "command",
              title: "Thinking",
              rows: [
                { label: "provider", value: "Claude" },
                { label: "adaptive", value: enabled ? "enabled" : "disabled" },
              ],
            },
          ]);
          setInput("");
          return;
        }
        if (arg !== "on" && arg !== "off") {
          setItems((prev) => [
            ...prev,
            { kind: "error", text: "Usage: /thinking on | /thinking off" },
          ]);
          setInput("");
          return;
        }
        const enabled = arg === "on";
        saveThinkingEnabled(meta.provider, enabled);
        onChangeModel(meta.model);
        setItems((prev) => [
          ...prev,
          {
            kind: "assistant",
            text: `Claude thinking ${enabled ? "enabled" : "disabled"}.`,
          },
        ]);
        setInput("");
        return;
      }
      if (text === "/help") {
        setItems((prev) => [
          ...prev,
          {
            kind: "command",
            title: "Commands",
            rows: ALL_SLASH_COMMANDS.map((cmd) => ({
              label: cmd.name,
              value: cmd.desc,
            })),
          },
        ]);
        setInput("");
        return;
      }
      if (text === "/config") {
        const providerInfo = PROVIDER_CATALOG[meta.provider];
        setItems((prev) => [
          ...prev,
          {
            kind: "command",
            title: "Config",
            rows: [
              { label: "provider", value: `${providerInfo.displayName} (${meta.provider})` },
              { label: "model", value: meta.model },
              ...(meta.provider === "openai-oauth" || meta.provider === "claude"
                ? [{ label: "effort", value: getReasoningEffort(loadStoredConfig(), meta.provider) }]
                : []),
              ...(meta.provider === "claude"
                ? [{ label: "thinking", value: getThinkingEnabled(loadStoredConfig(), meta.provider) ? "adaptive" : "disabled" }]
                : []),
              {
                label: "context",
                value: contextStatus?.contextWindow
                  ? `${formatNumber(contextStatus.contextWindow)} tokens`
                  : "unknown",
              },
              { label: "streaming", value: providerInfo.supportsStreaming ? "yes" : "no" },
              { label: "tools", value: providerInfo.supportsTools ? "yes" : "no" },
              { label: "vision", value: providerInfo.supportsVision ? "yes" : "no" },
            ],
          },
        ]);
        setInput("");
        return;
      }
      if (text === "/graph" || text === "/graph build" || text === "/graph rebuild") {
        setInput("");
        setItems((prev) => [
          ...prev,
          { kind: "command", title: "Graph", rows: [{ label: "building", value: "scanning project files…" }] },
        ]);
        const cwd = process.cwd();
        void buildAndSaveGraph(cwd)
          .then((summary) => {
            recordGraphBuilt(cwd);
            const rows = [
              { label: "files", value: String(summary.fileCount) },
              { label: "nodes", value: String(summary.nodeCount) },
              { label: "edges", value: String(summary.edgeCount) },
              { label: "saved", value: summary.path },
            ];
            if (summary.droppedEdges > 0) {
              rows.push({ label: "dropped", value: `${summary.droppedEdges} unresolved edges` });
            }
            setItems((prev) => [...prev, { kind: "command", title: "Graph built", rows }]);
          })
          .catch((err) => {
            setItems((prev) => [
              ...prev,
              { kind: "error", text: `graph build failed: ${err instanceof Error ? err.message : String(err)}` },
            ]);
          });
        return;
      }
      // Unknown slash command: never forward it to the model.
      if (text.startsWith("/")) {
        setItems((prev) => [
          ...prev,
          {
            kind: "error",
            text: `unknown command: ${text}. Try /help.`,
          },
        ]);
        setInput("");
        return;
      }

      setItems((prev) => [...prev, { kind: "user", text }]);
      setInput("");
      await runTurn(text);
    },
    [busy, exit, activeTheme.id, onTriggerSetup, onTriggerResume, selectModel, selectTheme, runTurn, userQuestionRequest, selectedQuestionOptionIndex, setUserQuestionRequest],
  );
  const streamingPreview = streaming;
  const messageWidth = Math.max(32, terminalSize.width - 4);

  // The transcript ScrollBox uses flexGrow={1}, so it yields height to whatever
  // overlay (picker/approval/menu) opens below it automatically — no manual row
  // budgeting needed (unlike the old fixed-height ScrollViewport).

  const chatInput = (
    <ChatInput
      value={input}
      onChange={setInput}
      onSubmit={submit}
      width={messageWidth}
      active={!mcpPanelOpen}
      submitEnabled={
        !mcpPanelOpen &&
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
    <Box flexDirection="column" flexGrow={1} width="100%" paddingX={1} paddingY={0}>
      {/* Virtualized transcript on the vendored Ink fork's ScrollBox: only the
          items in view (+ overscan) are mounted, heights come from real Yoga
          measurement, and scroll is imperative (smooth on long chats). The live
          streaming reply / thinking indicator / empty-state hint ride in the
          `footer` — outside the virtualized window — so a streamed token never
          re-renders the history. Wheel + PageUp/PageDown drive scrollRef. */}
      <VirtualTranscript
        items={items}
        scrollRef={scrollRef}
        columns={terminalSize.width}
        width={messageWidth}
        theme={activeTheme}
        provider={meta.provider}
        model={meta.model}
        footer={
          items.length === 1 && items[0]?.kind === "intro" && !busy ? (
            <Box marginTop={1}>
              <Text color={activeTheme.muted}>
                lucky › Input instruction payload or type / for command directory...
              </Text>
            </Box>
          ) : busy && !approvalRequest && !userQuestionRequest ? (
            <Box marginY={0.5} flexDirection="column">
              {streamingPreview ? (
                // The live assistant message: one block with one "lucky" header,
                // rendered identically to the finalized transcript item so it
                // doesn't jump when the turn ends.
                <StreamingPreview text={streamingPreview} theme={activeTheme} />
              ) : (
                <ThinkingStatus
                  theme={activeTheme}
                  elapsedSeconds={elapsedSeconds}
                  frame={activityFrame}
                />
              )}
            </Box>
          ) : null
        }
      />

      {effortPicker ? (
        <Box
          flexDirection="column"
          paddingLeft={2}
          marginBottom={0.5}
          width="100%"
        >
          <Text bold color={activeTheme.accent}>
            🧠 REASONING EFFORT FOR {effortPicker.model.toUpperCase()}
          </Text>
          <Box flexDirection="column" marginTop={0.2}>
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
          marginBottom={0.5}
          width="100%"
        >
          <Text bold color={activeTheme.accent}>
            🤖 SELECT MODEL FOR {PROVIDER_CATALOG[meta.provider].displayName.toUpperCase()}
          </Text>
          <Box flexDirection="column" marginTop={0.2}>
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
          marginBottom={0.5}
          width="100%"
        >
          <Text bold color={activeTheme.accent}>🎨 CHOOSE INTERFACE THEME</Text>
          <Box flexDirection="column" marginTop={0.2}>
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
                    ┃ {theme.name}
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
      ) : null}

      <Box flexDirection="column" width="100%" marginTop={0.5}>
        <Text color={activeTheme.muted}>{"─".repeat(terminalSize.width - 2)}</Text>
        <Box flexDirection="column" paddingX={0} width="100%" marginY={0.1}>
          {approvalRequest ? (
            // Permission prompt lives inside the input frame, which grows to
            // fit it — the same place the user would otherwise be typing.
            <ApprovalRequestView
              request={approvalRequest}
              selectedIndex={selectedApprovalIndex}
              options={approvalOptions}
              theme={activeTheme}
              width={messageWidth}
            />
          ) : userQuestionRequest ? (
            <Box flexDirection="column">
              <UserQuestionRequestView
                request={userQuestionRequest}
                selectedIndex={selectedQuestionOptionIndex}
                theme={activeTheme}
                width={messageWidth}
              />
              {(userQuestionRequest.allowFreeText ?? true) ? (
                <Box marginTop={0.5}>{chatInput}</Box>
              ) : null}
            </Box>
          ) : (
            chatInput
          )}
        </Box>
        <Text color={activeTheme.muted}>{"─".repeat(terminalSize.width - 2)}</Text>
      </Box>

      {/* Slash-command menu sits just below the prompt (Claude Code style). */}
      {showSlashMenu && filteredCommands.length > 0 ? (
        <Box flexDirection="column" paddingLeft={2} marginTop={0.2} width="100%">
          {filteredCommands.map((cmd, idx) => (
            <Box key={cmd.name} flexDirection="row">
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

      <Box width="100%" paddingX={0} justifyContent="space-between" marginTop={0.2}>
        <Box flexDirection="row" gap={1}>
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
        <Box flexDirection="row" gap={1}>
          {items.length > 1 ? (
            <Text color={activeTheme.muted} dimColor>
              PgUp/wheel to scroll{"  "}
            </Text>
          ) : null}
          <Text color={activeTheme.muted} dimColor>
            {formatStatusFooter(contextStatus, {
              ...(footerEffort ? { effort: footerEffort } : {}),
              ...(footerThinking ? { thinking: footerThinking } : {}),
            })}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

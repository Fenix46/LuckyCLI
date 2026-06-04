import { Box, Text, useApp, useInput, useWindowSize } from "ink";
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
  buildAndSaveGraph,
  createSessionId,
  deriveTitle,
  listSessions,
  loadStoredConfig,
  recordGraphBuilt,
  saveSession,
  saveStoredConfig,
  withMcpServer,
  withoutMcpServer,
} from "@luckycli/core";
import { checkForUpdate, updateRows } from "../update.js";
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
import { useMouseWheel } from "./hooks/useMouseWheel.js";
import { useTurnRunner } from "./hooks/useTurnRunner.js";
import { APP_VERSION } from "./components/constants.js";
import { ThinkingStatus } from "./components/ThinkingStatus.js";
import { StreamingPreview } from "./components/StreamingPreview.js";
import { ChatInput } from "./components/ChatInput.js";
import { PickerHint } from "./components/PickerHint.js";
import { TranscriptItem } from "./components/Transcript.js";
import { ScrollViewport } from "./components/ScrollViewport.js";
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
  { name: "/mcp", desc: "Open the interactive MCP control panel" },
  { name: "/status", desc: "Show provider auth, account, quota and context status" },
  { name: "/update", desc: "Check for a newer LuckyCLI release" },
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
    resumed ? [{ kind: "intro" }, ...messagesToItems(resumed.messages)] : [{ kind: "intro" }],
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

  // Real-time metrics
  const [tokenUsage, setTokenUsage] = useState({ input: 0, output: 0 });
  const [contextStatus, setContextStatus] = useState<ContextStatus | null>(null);

  // Scrollback within the alternate-screen viewport. scrollUp = lines revealed
  // above the bottom (0 = pinned to newest); maxScroll is reported by the viewport.
  const [scrollUp, setScrollUp] = useState(0);
  const [maxScroll, setMaxScroll] = useState(0);
  const maxScrollRef = useRef(0);
  maxScrollRef.current = maxScroll;

  const onWheel = useCallback((direction: "up" | "down", ticks: number) => {
    // One line per wheel tick. macOS momentum scrolling fires many ticks for a
    // flick and few for a gentle roll, so 1 line/tick feels natural (fast flick
    // = fast scroll) without overshooting like a larger fixed step would.
    setScrollUp((prev) => {
      const next = direction === "up" ? prev + ticks : prev - ticks;
      return Math.min(maxScrollRef.current, Math.max(0, next));
    });
  }, []);
  useMouseWheel(onWheel);

  const appendItems = useCallback(
    (next: Item[]) => {
      // New content arrived: snap back to the bottom so it's visible.
      setScrollUp(0);
      setItems((prev) => [...prev, ...next]);
    },
    [],
  );
  const patchTool = useCallback(
    (name: string, output: string, error: boolean) =>
      setItems((prev) => patchLastTool(prev, name, output, error)),
    [],
  );
  const onUsage = useCallback(
    (usage: TokenUsage) =>
      setTokenUsage((prev) => ({
        input: prev.input + usage.inputTokens,
        output: prev.output + usage.outputTokens,
      })),
    [],
  );
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
    let cancelled = false;
    checkForUpdate(APP_VERSION)
      .then((info) => {
        if (cancelled || !info.updateAvailable) return;
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
  const modelPicker = getModelPickerState(input, meta.provider, meta.model);
  const [selectedModelIndex, setSelectedModelIndex] = useState(0);
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
      setScrollUp((prev) => {
        const next = key.pageUp ? prev + page : prev - page;
        return Math.min(maxScroll, Math.max(0, next));
      });
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

  const selectModel = useCallback(
    (model: string) => {
      const validation = validateModel(meta.provider, model);
      if (!validation.ok) {
        setItems((prev) => [...prev, { kind: "error", text: validation.message }]);
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
    [meta.provider, onChangeModel],
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
      if (text === "/update") {
        try {
          const info = await checkForUpdate(APP_VERSION, { force: true });
          setItems((prev) => [
            ...prev,
            {
              kind: "command",
              title: info.updateAvailable ? "Update Available" : "Update",
              rows: updateRows(info),
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
        setInput("");
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

  // An open picker/menu renders between the transcript and the input frame and
  // is NOT part of CHROME_ROWS. In the fixed-height alternate screen that extra
  // height would overflow the layout (the input/footer get pushed off and the
  // menu misrenders). Reserve rows for whichever overlay is open so the
  // transcript viewport shrinks to make room. Each list is header + items +
  // hint (~3 rows of chrome); cap so a huge list still leaves a usable viewport.
  let overlayRows = 0;
  if (approvalRequest) {
    // Header + question + target + up to ~8 preview lines + 3 options + hint,
    // rendered inside the input frame. Reserve generously so it never spills
    // past the bottom of the screen.
    overlayRows = 16;
  } else if (userQuestionRequest) {
    // Header + question + options + hint (+ the input line when free-text).
    const options = userQuestionRequest.options?.length ?? 0;
    overlayRows = Math.min(16, options + 6);
  } else if (mcpPanelOpen) {
    const rows = mcpPanelTab === "installed" ? installedMcpRows.length : mcpPanelResults.length;
    overlayRows = Math.min(14, rows + 4);
  } else if (modelPicker.open) {
    overlayRows = Math.min(14, Math.max(1, modelPicker.items.length) + 3);
  } else if (themePicker.open) {
    overlayRows = Math.min(14, Math.max(1, themePicker.items.length) + 3);
  } else if (showSlashMenu && filteredCommands.length > 0) {
    overlayRows = Math.min(14, filteredCommands.length + 3);
  }
  const transcriptHeight = Math.max(3, terminalSize.height - CHROME_ROWS - overlayRows);

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
    <Box flexDirection="column" width={terminalSize.width} height={terminalSize.height} paddingX={1} paddingY={0}>
      {/* Transcript viewport: a fixed-height region that pins the newest content
          to the bottom and clips older content off the top (chat-style). In the
          alternate screen Ink owns the screen and redraws in place, so the
          streaming reply renders at full height with no scrollback duplication.
          PageUp/PageDown scroll back through the history. */}
      <ScrollViewport
        height={transcriptHeight}
        scrollUp={scrollUp}
        contentKey={`${items.length}:${streaming.length}:${busy ? 1 : 0}:${overlayRows}:${terminalSize.width}x${terminalSize.height}`}
        onMaxScrollChange={setMaxScroll}
      >
        {items.map((item, index) => (
          <TranscriptItem
            key={`item-${index}`}
            item={item}
            previous={index > 0 ? items[index - 1] : undefined}
            theme={activeTheme}
            width={messageWidth}
            provider={meta.provider}
            model={meta.model}
          />
        ))}

        {items.length === 1 && items[0]?.kind === "intro" && !busy ? (
          <Box marginTop={1}>
            <Text color={activeTheme.muted}>
              lucky › Input instruction payload or type / for command directory...
            </Text>
          </Box>
        ) : null}

        {busy && !approvalRequest && !userQuestionRequest ? (
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
        ) : null}
      </ScrollViewport>

      {modelPicker.open ? (
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
                    {model}
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
          {maxScroll > 0 ? (
            <Text color={activeTheme.accent} dimColor>
              {scrollUp > 0 ? `↑ ${scrollUp}/${maxScroll} scrolled · PgUp/PgDn` : "PgUp to scroll back"}
              {"  "}
            </Text>
          ) : null}
          <Text color={activeTheme.muted} dimColor>
            {formatStatusFooter(contextStatus, tokenUsage)}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

import { Box, Static, Text, useApp, useInput } from "ink";
import React, { useCallback, useState, useEffect, useRef } from "react";
import {
  CachedMcpCatalog,
  OfficialMcpRegistryCatalog,
  PROVIDER_CATALOG,
  catalogDetailToPreset,
  type Agent,
  type AgentEvent,
  type AskUserRequest,
  type CatalogServerSummary,
  type ContextStatus,
  type Message,
  type McpManager,
  type McpServerConfig,
  type ProviderStatus,
  type ProviderId,
  type ProviderQuotaStatus,
  type Session,
  type ToolApproval,
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
import { buildInstalledMcpRows, type InstalledMcpRow } from "./lib/mcp-rows.js";
import {
  getModelPickerState,
  getThemePickerState,
  getAvailableModels,
  validateModel,
} from "./lib/model-picker.js";
import {
  formatNumber,
  preview,
  truncateSingleLine,
  inputString,
  wrapText,
} from "./lib/format.js";
import {
  contextRows,
  formatStatusFooter,
} from "./lib/status.js";
import { humanizeError } from "./lib/errors.js";
import { Markdown } from "./markdown/Markdown.js";
import { streamingTail } from "./markdown/streaming.js";
import { useTerminalSize } from "./hooks/useTerminalSize.js";
import { useElapsedTimer } from "./hooks/useElapsedTimer.js";
import { APP_VERSION } from "./components/constants.js";
import { ThinkingStatus } from "./components/ThinkingStatus.js";
import { ChatInput } from "./components/ChatInput.js";
import { PickerHint } from "./components/PickerHint.js";
import { TranscriptItem, ItemView } from "./components/Transcript.js";

interface AppMeta {
  provider: ProviderId;
  model: string;
}

type McpPanelTab = "installed" | "search";

export interface ApprovalRequest {
  name: string;
  input: unknown;
  resolve: (decision: ToolApproval) => void;
}

export interface UserQuestionRequest extends AskUserRequest {
  resolve: (answer: string) => void;
}

/** Session-wide tool-approval mode, cycled from the prompt with Shift+Tab. */
export type PermissionMode = "normal" | "acceptEdits";

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
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState("");
  const streamingFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStreamingRef = useRef("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const { elapsedSeconds, activityFrame } = useElapsedTimer(busy, startedAt);
  const abortControllerRef = useRef<AbortController | null>(null);
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

  // Terminal resizing support (Ink-native: tracks the renderer's stdout).
  const terminalSize = useTerminalSize();

  useEffect(() => {
    return () => {
      if (streamingFlushTimerRef.current) {
        clearTimeout(streamingFlushTimerRef.current);
      }
    };
  }, []);

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

    // 1. Tool safety approval has highest precedence
    if (approvalRequest) {
      if (key.ctrl && _in === "c") {
        approvalRequest.resolve("deny");
        setApprovalRequest(null);
        abortControllerRef.current?.abort();
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
        if (decision === "deny") abortControllerRef.current?.abort();
        return;
      }
      if (key.escape) {
        approvalRequest.resolve("deny");
        setApprovalRequest(null);
        abortControllerRef.current?.abort();
      }
      return;
    }

    // 2. User question from ask_user tool
    if (userQuestionRequest) {
      const options = userQuestionRequest.options ?? [];
      if (key.ctrl && _in === "c") {
        userQuestionRequest.resolve("User cancelled the question.");
        setUserQuestionRequest(null);
        abortControllerRef.current?.abort();
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
        abortControllerRef.current?.abort();
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
      abortControllerRef.current?.abort();
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
      abortControllerRef.current?.abort();
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
      setBusy(true);
      setStartedAt(Date.now());

      let assistantBuf = "";
      const publishStreaming = () => {
        if (streamingFlushTimerRef.current) {
          clearTimeout(streamingFlushTimerRef.current);
          streamingFlushTimerRef.current = null;
        }
        if (pendingStreamingRef.current) {
          setStreaming(pendingStreamingRef.current);
          pendingStreamingRef.current = "";
        }
      };
      const scheduleStreaming = () => {
        pendingStreamingRef.current = assistantBuf;
        if (streamingFlushTimerRef.current) return;
        streamingFlushTimerRef.current = setTimeout(() => {
          streamingFlushTimerRef.current = null;
          if (!pendingStreamingRef.current) return;
          setStreaming(pendingStreamingRef.current);
          pendingStreamingRef.current = "";
        }, 180);
      };
      const flushAssistant = () => {
        publishStreaming();
        if (!assistantBuf.trim()) return;
        const text = assistantBuf;
        assistantBuf = "";
        setStreaming("");
        setItems((prev) => [
          ...prev,
          { kind: "assistant", text },
        ]);
      };
      const controller = new AbortController();
      abortControllerRef.current = controller;
      try {
        for await (const event of agent.send(text, controller.signal)) {
          handleEvent(event, {
            onText: (delta) => {
              assistantBuf += delta;
              scheduleStreaming();
            },
            onToolStart: (name, rawInput) => {
              // A tool call ends the current narration block — commit it to the
              // transcript instead of discarding it, so text the model wrote
              // before the tool is preserved (and the live preview clears).
              flushAssistant();
              setItems((prev) => [
                ...prev,
                { kind: "tool", name, input: rawInput },
              ]);
            },
            onToolEnd: (name, output, error) =>
              setItems((prev) => patchLastTool(prev, name, output, error)),
            onError: (message) => {
              flushAssistant();
              setItems((prev) => [
                ...prev,
                { kind: "error", text: humanizeError(message) },
              ]);
            },
            onContext: (status) => {
              setContextStatus(status);
            },
            onCompacted: (result) => {
              setItems((prev) => [
                ...prev,
                {
                  kind: "command",
                  title: "Auto Compaction",
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
            },
            onTurnEnd: (usage) => {
              if (usage) {
                setTokenUsage((prev) => ({
                  input: prev.input + usage.inputTokens,
                  output: prev.output + usage.outputTokens,
                }));
              }
            },
            onAborted: () => {
              flushAssistant();
              setItems((prev) => [
                ...prev,
                { kind: "error", text: "Interrupted by user." },
              ]);
            },
          });
        }
      } finally {
        publishStreaming();
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        flushAssistant();
        setStreaming("");
        setBusy(false);
        setStartedAt(null);
        persistSession();
      }
    },
    [agent, busy, meta, exit, activeTheme.id, contextStatus, onTriggerSetup, onTriggerResume, selectModel, selectTheme, persistSession, userQuestionRequest, selectedQuestionOptionIndex, setUserQuestionRequest],
  );
  const lastItem = items.at(-1);
  const liveTail =
    lastItem?.kind === "tool" && lastItem.output === undefined
      ? lastItem
      : undefined;
  const staticItems = liveTail ? items.slice(0, -1) : items;
  const streamingPreview = streaming ? streamingTail(streaming) : "";
  const messageWidth = Math.max(32, terminalSize.width - 4);

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
    <Box flexDirection="column" width={terminalSize.width} paddingX={1} paddingY={0}>
      <Static items={staticItems}>
        {(item, index) => (
          <TranscriptItem
            key={`static-${index}`}
            item={item}
            previous={index > 0 ? staticItems[index - 1] : undefined}
            theme={activeTheme}
            width={messageWidth}
            provider={meta.provider}
            model={meta.model}
          />
        )}
      </Static>

      <Box flexDirection="column" marginY={0.5}>
        {staticItems.length === 1 && staticItems[0]?.kind === "intro" && !liveTail && !busy ? (
          <Box marginTop={1}>
            <Text color={activeTheme.muted}>
              lucky › Input instruction payload or type / for command directory...
            </Text>
          </Box>
        ) : null}

        {liveTail ? (
          <Box marginY={0.5} flexDirection="column">
            <ItemView item={liveTail} theme={activeTheme} width={messageWidth} />
          </Box>
        ) : null}

        {busy && !approvalRequest && !userQuestionRequest ? (
          <Box marginY={0.5} flexDirection="column">
            <ThinkingStatus
              theme={activeTheme}
              elapsedSeconds={elapsedSeconds}
              frame={activityFrame}
            />
            {streamingPreview ? (
              <Box paddingLeft={2} marginTop={0.2}>
                <Markdown text={streamingPreview} theme={activeTheme} />
              </Box>
            ) : null}
          </Box>
        ) : null}
      </Box>

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
      ) : showSlashMenu && filteredCommands.length > 0 ? (
        <Box
          flexDirection="column"
          paddingLeft={2}
          marginBottom={0.5}
          width="100%"
        >
          <Text bold color={activeTheme.accent}>📂 AVAILABLE SLASH COMMANDS</Text>
          <Box flexDirection="column" marginTop={0.2}>
            {filteredCommands.map((cmd, idx) => (
              <Box key={cmd.name} flexDirection="row">
                <Text color={idx === selectedCommandIndex ? activeTheme.accent : "gray"}>
                  {idx === selectedCommandIndex ? "❯ " : "  "}
                </Text>
                <Text bold color={idx === selectedCommandIndex ? activeTheme.primary : "white"}>
                  {cmd.name.padEnd(12)}
                </Text>
                <Text color={idx === selectedCommandIndex ? "white" : activeTheme.muted}>
                  {idx === selectedCommandIndex ? "┃ " : "┆ "}
                  {cmd.desc}
                </Text>
              </Box>
            ))}
          </Box>
          <PickerHint theme={activeTheme} selectLabel="complete" />
        </Box>
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
          <Text color={activeTheme.muted} dimColor>
            {formatStatusFooter(contextStatus, tokenUsage)}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}


function McpPanel({
  theme,
  width,
  tab,
  installedRows,
  selectedInstalledIndex,
  query,
  results,
  selectedSearchIndex,
  loading,
  error,
}: {
  theme: Theme;
  width: number;
  tab: McpPanelTab;
  installedRows: InstalledMcpRow[];
  selectedInstalledIndex: number;
  query: string;
  results: CatalogServerSummary[];
  selectedSearchIndex: number;
  loading: boolean;
  error: string | null;
}): React.JSX.Element {
  return (
    <Box flexDirection="column" paddingLeft={2} marginBottom={0.5} width="100%">
      <Text bold color={theme.accent}>🧩 MCP CONTROL PANEL</Text>
      <Box flexDirection="row" marginTop={0.2}>
        <Text bold color={tab === "installed" ? theme.primary : theme.muted}>
          {tab === "installed" ? "❯ " : "  "}Installed
        </Text>
        <Text color={theme.muted}>   </Text>
        <Text bold color={tab === "search" ? theme.primary : theme.muted}>
          {tab === "search" ? "❯ " : "  "}Search
        </Text>
      </Box>

      {tab === "installed" ? (
        <Box flexDirection="column" marginTop={0.4}>
          {installedRows.length === 0 ? (
            <Text color={theme.muted}>No MCP servers configured.</Text>
          ) : (
            installedRows.map((row, idx) => (
              <Box key={row.name} flexDirection="row">
                <Text color={idx === selectedInstalledIndex ? theme.accent : "gray"}>
                  {idx === selectedInstalledIndex ? "❯ " : "  "}
                </Text>
                <Text bold color={idx === selectedInstalledIndex ? theme.primary : "white"}>
                  {row.name.padEnd(22)}
                </Text>
                <Text color={idx === selectedInstalledIndex ? "white" : theme.muted}>
                  ┃ {truncateSingleLine(row.summary, Math.max(20, width - 32))}
                </Text>
              </Box>
            ))
          )}
          <Box marginTop={0.5}>
            <Text color={theme.muted}>Enter toggle enable · d remove · r reload · Tab switch tab · Esc close</Text>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={0.4}>
          <Text color={theme.muted}>query: <Text color="white">{query || "(type to search official registry)"}</Text></Text>
          {loading ? (
            <Text color={theme.accent}>Searching MCP registry...</Text>
          ) : error ? (
            <Text color={theme.error}>{error}</Text>
          ) : results.length === 0 ? (
            <Text color={theme.muted}>No search results.</Text>
          ) : (
            results.map((item, idx) => (
              <Box key={item.name} flexDirection="row">
                <Text color={idx === selectedSearchIndex ? theme.accent : "gray"}>
                  {idx === selectedSearchIndex ? "❯ " : "  "}
                </Text>
                <Text bold color={idx === selectedSearchIndex ? theme.primary : "white"}>
                  {truncateSingleLine(item.name, 28)}
                </Text>
                <Text color={idx === selectedSearchIndex ? "white" : theme.muted}>
                  ┃ {truncateSingleLine(item.title ?? item.description ?? item.version ?? "no description", Math.max(20, width - 38))}
                </Text>
              </Box>
            ))
          )}
          <Box marginTop={0.5}>
            <Text color={theme.muted}>Type to search · Enter install selected · Tab switch tab · Esc close</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

/**
 * Lucky's mascot: the lucky black cat with pointy ears and a four-leaf clover,
 * hugging a terminal. Drawn so every row lines up in a monospace font.
 */



function ApprovalRequestView({
  request,
  selectedIndex,
  options,
  theme,
  width,
}: {
  request: ApprovalRequest;
  selectedIndex: number;
  options: readonly ("allow" | "always" | "deny")[];
  theme: Theme;
  width: number;
}): React.JSX.Element {
  const detail = approvalDisplay(request, width);
  const panelWidth = Math.max(48, Math.min(width, 104));
  return (
    <Box
      flexDirection="column"
      marginY={0.5}
      width={panelWidth}
      borderStyle="single"
      borderColor={theme.warning}
      borderTop={false}
      borderRight={false}
      borderBottom={false}
      paddingLeft={2}
    >
      <Box flexDirection="row">
        <Text bold color={theme.warning}>● Permission required</Text>
        <Text color={theme.muted}>  ·  </Text>
        <Text bold color={theme.accent}>{request.name}</Text>
      </Box>

      <Box marginTop={0.3}>
        <Text bold color="white">{detail.question}</Text>
      </Box>

      {detail.target ? (
        <Box marginTop={0.2} flexDirection="row">
          <Text color={theme.muted}>target  </Text>
          <Text color={theme.primary}>{detail.target}</Text>
        </Box>
      ) : null}

      {detail.preview.length > 0 ? (
        <Box flexDirection="column" marginTop={0.4}>
          {detail.preview.map((line, index) => (
            <Box key={index} flexDirection="row">
              <Text color={theme.muted} dimColor>│ </Text>
              <Text color={line.color === "added" ? theme.success : line.color === "removed" ? theme.error : theme.muted}>
                {line.text}
              </Text>
            </Box>
          ))}
        </Box>
      ) : null}

      <Box flexDirection="column" marginTop={0.6}>
        {options.map((option, index) => (
          <ApprovalOptionView
            key={option}
            option={option}
            selected={index === selectedIndex}
            theme={theme}
          />
        ))}
      </Box>

      <Box marginTop={0.4}>
        <Text color={theme.muted} dimColor>↑↓ / jk move · enter approve · esc reject</Text>
      </Box>
    </Box>
  );
}

function ApprovalOptionView({
  option,
  selected,
  theme,
}: {
  option: "allow" | "always" | "deny";
  selected: boolean;
  theme: Theme;
}): React.JSX.Element {
  const label =
    option === "allow" ? "Allow once" : option === "always" ? "Allow always" : "Reject";
  const description =
    option === "allow"
      ? "Run this tool call"
      : option === "always"
        ? "Remember this exact request for this session"
        : "Block it and continue";
  const color = option === "deny" ? theme.error : option === "always" ? theme.accent : theme.success;
  return (
    <Box flexDirection="row">
      <Text bold={selected} color={selected ? color : theme.muted}>
        {selected ? "❯ " : "  "}
        {label.padEnd(14)}
      </Text>
      <Text color={selected ? "white" : theme.muted} dimColor={!selected}>{description}</Text>
    </Box>
  );
}

function UserQuestionRequestView({
  request,
  selectedIndex,
  theme,
  width,
}: {
  request: UserQuestionRequest;
  selectedIndex: number;
  theme: Theme;
  width: number;
}): React.JSX.Element {
  const options = request.options ?? [];
  const freeText = request.allowFreeText ?? true;
  const panelWidth = Math.max(48, Math.min(width, 104));
  return (
    <Box
      flexDirection="column"
      marginY={0.5}
      width={panelWidth}
      borderStyle="single"
      borderColor={theme.accent}
      borderTop={false}
      borderRight={false}
      borderBottom={false}
      paddingLeft={2}
    >
      <Box flexDirection="row">
        <Text bold color={theme.accent}>● Question from agent</Text>
        <Text color={theme.muted}>  ·  </Text>
        <Text bold color={theme.accent}>ask_user</Text>
      </Box>

      <Box marginTop={0.3}>
        <Text bold color="white">{request.question}</Text>
      </Box>

      {options.length > 0 ? (
        <Box flexDirection="column" marginTop={0.6}>
          {options.map((option, index) => (
            <Box key={`${option}-${index}`} flexDirection="row">
              <Text bold={index === selectedIndex} color={index === selectedIndex ? theme.accent : theme.muted} dimColor={index !== selectedIndex}>
                {index === selectedIndex ? "❯ " : "  "}
                {option}
              </Text>
            </Box>
          ))}
        </Box>
      ) : null}

      <Box marginTop={0.4}>
        <Text color={theme.muted} dimColor>
          {freeText
            ? "type an answer · enter to send"
            : "↑↓ / jk move · enter answer · esc skip"}
          {freeText && options.length > 0 ? " · empty enter uses selected" : ""}
        </Text>
      </Box>
    </Box>
  );
}

interface ApprovalDisplay {
  question: string;
  target?: string;
  preview: { text: string; color?: "added" | "removed" | "muted" }[];
}

function approvalDisplay(request: ApprovalRequest, width: number): ApprovalDisplay {
  const previewWidth = Math.max(32, Math.min(width - 8, 96));
  if (request.name === "exec") {
    const command = inputString(request.input, "command");
    return {
      question: "Run this shell command?",
      preview: command ? codePreview(command, previewWidth, 5) : [],
    };
  }

  if (request.name === "edit_file") {
    const path = inputString(request.input, "path");
    const oldString = inputString(request.input, "oldString");
    const newString = inputString(request.input, "newString");
    return {
      question: "Apply this edit?",
      ...(path ? { target: path } : {}),
      preview: editPreview(oldString, newString, previewWidth),
    };
  }

  if (request.name === "write_file") {
    const path = inputString(request.input, "path");
    const content = inputString(request.input, "content");
    return {
      question: "Write this file?",
      ...(path ? { target: path } : {}),
      preview: content ? codePreview(content, previewWidth, 8) : [],
    };
  }

  return {
    question: `Run ${request.name}?`,
    preview: objectPreview(request.input, previewWidth),
  };
}

function editPreview(
  oldString: string | undefined,
  newString: string | undefined,
  width: number,
): { text: string; color?: "added" | "removed" | "muted" }[] {
  const lines: { text: string; color?: "added" | "removed" | "muted" }[] = [];
  if (oldString) {
    lines.push({ text: "Remove:", color: "muted" });
    lines.push(...codePreview(oldString, width - 2, 5, "- ", "removed"));
  }
  if (newString) {
    if (lines.length > 0) lines.push({ text: "", color: "muted" });
    lines.push({ text: "Add:", color: "muted" });
    lines.push(...codePreview(newString, width - 2, 5, "+ ", "added"));
  }
  return lines.length > 0 ? lines : [{ text: "No preview available", color: "muted" }];
}

function codePreview(
  value: string,
  width: number,
  maxLines: number,
  prefix = "  ",
  color: "added" | "removed" | "muted" = "muted",
): { text: string; color?: "added" | "removed" | "muted" }[] {
  const normalized = value.replace(/\t/g, "  ");
  const rawLines = normalized.split("\n");
  const visibleLines = rawLines.slice(0, maxLines);
  const lines = visibleLines.flatMap((line) =>
    wrapText(`${prefix}${line || " "}`, width).map((wrapped) => ({ text: wrapped, color })),
  );
  if (rawLines.length > maxLines) {
    lines.push({ text: `${prefix}… ${rawLines.length - maxLines} more lines`, color: "muted" });
  }
  return lines;
}

function objectPreview(
  input: unknown,
  width: number,
): { text: string; color?: "added" | "removed" | "muted" }[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return [];
  }
  return Object.entries(input as Record<string, unknown>)
    .slice(0, 8)
    .map(([key, value]) => {
      const rendered =
        typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
      return {
        text: `  ${key}: ${truncateSingleLine(rendered, width - key.length - 4)}`,
        color: "muted" as const,
      };
    });
}


interface EventHandlers {
  onText: (delta: string) => void;
  onToolStart: (name: string, rawInput: unknown) => void;
  onToolEnd: (name: string, output: string, error: boolean) => void;
  onError: (message: string) => void;
  onContext: (status: ContextStatus) => void;
  onCompacted: (result: { beforeTokens?: number; afterTokens?: number; removedMessages: number; keptMessages: number }) => void;
  onTurnEnd: (usage?: TokenUsage) => void;
  onAborted: () => void;
}

function handleEvent(event: AgentEvent, h: EventHandlers): void {
  switch (event.type) {
    case "text":
      h.onText(event.delta);
      break;
    case "tool_start":
      h.onToolStart(event.name, event.input);
      break;
    case "tool_end":
      h.onToolEnd(event.name, event.content, event.isError);
      break;
    case "error":
      h.onError(event.message);
      break;
    case "context":
      h.onContext(event.status);
      break;
    case "context_compacted":
      h.onCompacted(event.result);
      break;
    case "turn_end":
      h.onTurnEnd(event.usage);
      break;
    case "aborted":
      h.onAborted();
      break;
  }
}

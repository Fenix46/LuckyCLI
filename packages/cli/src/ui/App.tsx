import { Box, Static, Text, useApp, useInput } from "ink";
import os from "node:os";
import React, { useCallback, useState, useEffect, useRef } from "react";
import {
  OfficialMcpRegistryCatalog,
  PROVIDER_CATALOG,
  catalogDetailToPreset,
  type Agent,
  type AgentEvent,
  type AskUserRequest,
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
} from "@luckycli/core";
import { checkForUpdate, updateRows } from "../update.js";
import { THEMES, themeById, type Theme } from "./themes.js";

/** Shown in the opening banner. Keep in sync with packages/cli/package.json. */
const APP_VERSION = "0.2.0";

interface AppMeta {
  provider: ProviderId;
  model: string;
}

/** A line in the scrollback transcript. */
type Item =
  | { kind: "intro" }
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; name: string; input: unknown; output?: string; error?: boolean }
  | { kind: "command"; title: string; rows: CommandRow[] }
  | { kind: "status"; provider: ProviderStatus; context: ContextStatus }
  | { kind: "error"; text: string };

interface CommandRow {
  label: string;
  value: string;
}

export function buildMcpCommandRows(
  mcpStatus: Record<string, { status: string; error?: string }>,
  toolCount: number,
): CommandRow[] {
  return Object.keys(mcpStatus).length === 0
    ? [
        { label: "servers", value: "none configured for this session" },
        { label: "tools", value: String(toolCount) },
      ]
    : [
        { label: "tools", value: String(toolCount) },
        ...Object.entries(mcpStatus).map(([name, status]) => ({
          label: name,
          value:
            status.status === "failed"
              ? `${status.status} · ${status.error}`
              : status.status,
        })),
      ];
}

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
  { name: "/mcp", desc: "Show MCP server and tool status for this session" },
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
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [activityFrame, setActivityFrame] = useState(0);
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

  // Terminal resizing support
  const [terminalSize, setTerminalSize] = useState({
    width: process.stdout.columns ?? 100,
    height: process.stdout.rows ?? 30,
  });

  useEffect(() => {
    function handleResize() {
      setTerminalSize({
        width: process.stdout.columns ?? 100,
        height: process.stdout.rows ?? 30,
      });
    }
    process.stdout.on("resize", handleResize);
    return () => {
      process.stdout.off("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (streamingFlushTimerRef.current) {
        clearTimeout(streamingFlushTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!busy || startedAt === null) {
      setElapsedSeconds(0);
      return;
    }
    const timer = setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
      setActivityFrame((frame) => frame + 1);
    }, 500);
    return () => clearInterval(timer);
  }, [busy, startedAt]);

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

  // Ctrl+C exits when idle. Support autocomplete and tool approval.
  useInput((_in, key) => {
    // 0. Shift+Tab cycles the session permission mode. Intercept it before any
    // other branch so it never triggers a plain-Tab action (option cycling,
    // slash-command completion). Ignore it while a modal/picker owns the keys.
    if (key.tab && key.shift) {
      const modalActive =
        Boolean(approvalRequest) ||
        Boolean(userQuestionRequest) ||
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
        const mcpStatus = mcpManager?.status() ?? {};
        const toolCount = mcpManager?.tools().length ?? 0;
        setItems((prev) => [
          ...prev,
          {
            kind: "command",
            title: "MCP",
            rows: buildMcpCommandRows(mcpStatus, toolCount),
          },
        ]);
        setInput("");
        return;
      }
      if (text.startsWith("/mcp search ")) {
        const query = text.slice("/mcp search ".length).trim();
        if (!query) {
          setItems((prev) => [...prev, { kind: "error", text: "usage: /mcp search <query>" }]);
          setInput("");
          return;
        }
        try {
          const catalog = new OfficialMcpRegistryCatalog();
          const result = await catalog.search(query);
          setItems((prev) => [
            ...prev,
            {
              kind: "command",
              title: `MCP Search: ${query}`,
              rows:
                result.items.length === 0
                  ? [{ label: "results", value: "no matches" }]
                  : result.items.map((item) => ({
                      label: item.name,
                      value: item.title ?? item.description ?? item.version ?? "no description",
                    })),
            },
          ]);
        } catch (error) {
          setItems((prev) => [
            ...prev,
            { kind: "error", text: error instanceof Error ? error.message : "failed to search MCP catalog" },
          ]);
        }
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
          const catalog = new OfficialMcpRegistryCatalog();
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
          const catalog = new OfficialMcpRegistryCatalog();
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
      submitEnabled={
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
                {parseMarkdownToReact(streamingPreview, activeTheme)}
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

function ThinkingStatus({
  theme,
  elapsedSeconds,
  frame,
}: {
  theme: Theme;
  elapsedSeconds: number;
  frame: number;
}): React.JSX.Element {
  const frames = ["●", "●", "◆", "◆", "▲", "▲"];
  const pulse = frames[frame % frames.length] ?? "●";
  const dots = ".".repeat((frame % 3) + 1).padEnd(3, " ");
  return (
    <Text bold color={theme.success}>
      {pulse} lucky{" "}
      <Text color={theme.accent}>
        thinking{dots}
      </Text>{" "}
      <Text color="white">({elapsedSeconds}s)</Text>
    </Text>
  );
}

function PromptBlock({
  text,
  width,
  cursorOffset,
  active = false,
}: {
  text: string;
  width: number;
  cursorOffset?: number;
  active?: boolean;
}): React.JSX.Element {
  const lineWidth = Math.max(18, width);

  // Active = the live input line. Keep it clean: a chevron prompt and the typed
  // text, with no "you" badge and no background fill. The full highlight is
  // reserved for sent messages so they stand out in the transcript.
  if (active) {
    const lines = promptBlockLines(text, cursorOffset, lineWidth, "› ");
    return (
      <Box flexDirection="column" width="100%">
        {lines.map((line, index) => (
          <Text key={`${index}-${line.text}`} color="#f2f5f8">
            {line.beforeCursor}
            {line.cursor ? <Text inverse>{line.cursor}</Text> : null}
            {line.afterCursor}
          </Text>
        ))}
      </Box>
    );
  }

  // Sent user message: a "you ›" badge over a full-width highlight, so the
  // user's own turns stay instantly distinguishable in the scrollback.
  const bg = "#223246";
  const fg = "#f2f5f8";
  const lines = promptBlockLines(text, cursorOffset, lineWidth, "you › ");

  return (
    <Box flexDirection="column" width="100%">
      {lines.map((line, index) => (
        <Text key={`${index}-${line.text}`} backgroundColor={bg} color={fg} bold={index === 0}>
          {line.beforeCursor}
          {line.cursor ? (
            <Text inverse backgroundColor={bg} color={fg}>
              {line.cursor}
            </Text>
          ) : null}
          {line.afterCursor}
          <Text backgroundColor={bg} color="#9ba6b8">
            {line.pad}
          </Text>
        </Text>
      ))}
    </Box>
  );
}

interface PromptBlockLine {
  text: string;
  beforeCursor: string;
  cursor: string;
  afterCursor: string;
  pad: string;
}

function promptBlockLines(
  text: string,
  cursorOffset: number | undefined,
  width: number,
  marker: string,
): PromptBlockLine[] {
  const logicalLines = (text || "").split("\n");
  const rows: PromptBlockLine[] = [];
  let offset = 0;

  logicalLines.forEach((line, index) => {
    const prefix = index === 0 ? marker : " ".repeat(marker.length);
    const available = Math.max(1, width - prefix.length);
    const chunks = chunkPromptLine(line, available);
    const lineStart = offset;
    const lineEnd = lineStart + line.length;
    const cursorOnLine =
      cursorOffset !== undefined && cursorOffset >= lineStart && cursorOffset <= lineEnd;

    chunks.forEach((chunk, chunkIndex) => {
      const chunkStart = lineStart + chunkIndex * available;
      const chunkEnd = chunkStart + chunk.length;
      const cursorOnChunk =
        cursorOnLine &&
        cursorOffset !== undefined &&
        cursorOffset >= chunkStart &&
        cursorOffset <= chunkEnd &&
        (cursorOffset < chunkEnd || chunkIndex === chunks.length - 1);
      const localCursor = cursorOnChunk && cursorOffset !== undefined
        ? cursorOffset - chunkStart
        : -1;
      const label = chunkIndex === 0 ? prefix : " ".repeat(prefix.length);
      const content = `${label}${chunk || " "}`;

      if (localCursor >= 0) {
        const cursorAbsolute = label.length + localCursor;
        const cursorChar = content[cursorAbsolute] ?? " ";
        const beforeCursor = content.slice(0, cursorAbsolute);
        const afterCursor = content.slice(cursorAbsolute + 1);
        rows.push(padPromptLine({ text: content, beforeCursor, cursor: cursorChar, afterCursor }, width));
      } else {
        rows.push(padPromptLine({ text: content, beforeCursor: content, cursor: "", afterCursor: "" }, width));
      }
    });

    offset = lineEnd + 1;
  });

  return rows;
}

function chunkPromptLine(line: string, width: number): string[] {
  if (line.length === 0) return [""];
  const chunks: string[] = [];
  for (let i = 0; i < line.length; i += width) {
    chunks.push(line.slice(i, i + width));
  }
  return chunks;
}

function padPromptLine(
  line: Omit<PromptBlockLine, "pad">,
  width: number,
): PromptBlockLine {
  const pad = " ".repeat(Math.max(0, width - line.text.length));
  return { ...line, pad };
}

function ChatInput({
  value,
  onChange,
  onSubmit,
  width,
  submitEnabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  width: number;
  submitEnabled: boolean;
}): React.JSX.Element {
  const [cursorOffset, setCursorOffset] = useState(value.length);

  useEffect(() => {
    setCursorOffset((offset) => Math.min(offset, value.length));
  }, [value.length]);

  useInput((input, key) => {
    if (key.upArrow || key.downArrow || key.tab || (key.ctrl && input === "c")) return;

    if (key.return || input === "\r" || input === "\n") {
      // Ink reports a *plain* Enter as key.return === true with no modifiers.
      // A modified Enter for a newline — Option/Alt+Enter on macOS, Ctrl+Enter
      // on Windows/Linux — reaches here differently: ink strips the ESC prefix
      // so it arrives as a bare "\r"/"\n" with key.return === false (Option on
      // macOS), or with key.ctrl/key.meta set. So anything that is NOT a plain
      // Enter inserts a newline; only a plain Enter submits.
      const isPlainEnter = key.return && !key.ctrl && !key.meta;
      if (!isPlainEnter) {
        const nextValue = insertAt(value, cursorOffset, "\n");
        onChange(nextValue);
        setCursorOffset(cursorOffset + 1);
        return;
      }
      if (!submitEnabled) return;
      onSubmit(value);
      return;
    }

    if (key.leftArrow) {
      setCursorOffset((offset) => Math.max(0, offset - 1));
      return;
    }

    if (key.rightArrow) {
      setCursorOffset((offset) => Math.min(value.length, offset + 1));
      return;
    }

    if (key.backspace || key.delete) {
      if (cursorOffset === 0) return;
      onChange(value.slice(0, cursorOffset - 1) + value.slice(cursorOffset));
      setCursorOffset(cursorOffset - 1);
      return;
    }

    if (!input) return;
    const nextValue = insertAt(value, cursorOffset, input);
    onChange(nextValue);
    setCursorOffset(cursorOffset + input.length);
  });

  return (
    <PromptBlock
      text={value}
      width={width}
      cursorOffset={cursorOffset}
      active
    />
  );
}

function insertAt(value: string, offset: number, text: string): string {
  return value.slice(0, offset) + text + value.slice(offset);
}

function PickerHint({
  theme,
  selectLabel = "select",
}: {
  theme: Theme;
  selectLabel?: string;
}): React.JSX.Element {
  return (
    <Box marginTop={0.5}>
      <Text color={theme.muted}>Up/Down to move · Enter to {selectLabel} · Esc to close</Text>
    </Box>
  );
}

/**
 * Lucky's mascot: the lucky black cat with pointy ears and a four-leaf clover,
 * hugging a terminal. Drawn so every row lines up in a monospace font.
 */
const MASCOT = [
  "  /\\     /\\     ☘",
  " /  \\___/  \\",
  "(   ●   ●   )",
  " \\    ▾    /",
  "  )       (",
  " [ >_      ]",
  " [ $_      ]",
  "  ‾‾‾‾‾‾‾‾‾",
];

/**
 * The opening banner shown on a fresh session — a bordered welcome card with a
 * mascot and provider info on the left, and a tips / what's-new panel on the
 * right, in the spirit of Claude Code's startup box.
 */
function IntroBanner({
  theme,
  provider,
  model,
}: {
  theme: Theme;
  provider: ProviderId;
  model: string;
}): React.JSX.Element {
  const name = firstName(os.userInfo().username);
  const providerName = PROVIDER_CATALOG[provider].displayName;
  const cwd = prettyCwd(process.cwd());

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.accent}
      paddingX={2}
      paddingY={1}
    >
      <Box marginBottom={1}>
        <Text bold color={theme.primary}>
          LuckyCLI{" "}
        </Text>
        <Text color={theme.muted}>v{APP_VERSION}</Text>
      </Box>

      <Box flexDirection="row">
        {/* Left: greeting + mascot + context */}
        <Box flexDirection="column" marginRight={3}>
          <Text bold color={theme.success}>
            Welcome back {name}!
          </Text>
          <Box flexDirection="column" marginY={1}>
            {MASCOT.map((line, i) => (
              <Text key={i} color={theme.success}>
                {line}
              </Text>
            ))}
          </Box>
          <Text color={theme.muted}>
            {providerName} · {model}
          </Text>
          <Text color={theme.muted}>multi-provider terminal agent</Text>
          <Text color={theme.muted}>{cwd}</Text>
        </Box>

        {/* Right: tips + what's new, divided by a vertical rule */}
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor={theme.muted}
          borderTop={false}
          borderRight={false}
          borderBottom={false}
          paddingLeft={3}
        >
          <Text bold color={theme.warning}>
            Tips for getting started
          </Text>
          <Text color={theme.muted}>Type / to open the command directory</Text>
          <Text color={theme.muted}>Run /model to switch model</Text>
          <Text color={theme.muted}>Run /status to check your provider</Text>
          <Text color={theme.muted}>Run /mcp to inspect MCP servers</Text>

          <Box marginTop={1}>
            <Text bold color={theme.warning}>
              What's new
            </Text>
          </Box>
          <Text color={theme.muted}>Resume sessions with --continue / --resume</Text>
          <Text color={theme.muted}>Single-binary install · no Node required</Text>
        </Box>
      </Box>
    </Box>
  );
}

/** Extract a friendly first name from a system username. */
function firstName(username: string): string {
  const cleaned = username.replace(/[._-]/g, " ").trim();
  const first = cleaned.split(" ")[0] ?? username;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/** Shorten an absolute path by collapsing the home directory to `~`. */
function prettyCwd(cwd: string): string {
  const home = os.homedir();
  return cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
}

function TranscriptItem({
  item,
  previous,
  theme,
  width,
  provider,
  model,
}: {
  item: Item;
  previous?: Item;
  theme: Theme;
  width: number;
  provider: ProviderId;
  model: string;
}): React.JSX.Element {
  return (
    <Box flexDirection="column" marginY={0.3}>
      {shouldSeparate(item, previous) ? (
        <TranscriptDelimiter theme={theme} width={width} />
      ) : null}
      <ItemView item={item} theme={theme} width={width} provider={provider} model={model} />
    </Box>
  );
}

function shouldSeparate(item: Item, previous?: Item): boolean {
  if (!previous) return false;
  if (item.kind === "tool" && previous.kind === "tool") return false;
  return item.kind !== previous.kind || item.kind === "user";
}

function TranscriptDelimiter({
  theme,
  width,
}: {
  theme: Theme;
  width: number;
}): React.JSX.Element {
  const line = "─".repeat(Math.max(12, Math.min(width, 100)));
  return (
    <Box marginY={0.2}>
      <Text color={theme.muted} dimColor>{line}</Text>
    </Box>
  );
}

function ItemView({
  item,
  theme,
  width,
  provider,
  model,
  streaming = false,
}: {
  item: Item;
  theme: Theme;
  width: number;
  provider?: ProviderId;
  model?: string;
  /**
   * Render mode for the live streaming message. The live buffer is tail-capped
   * and throttled before it reaches this component, so it can use the same
   * markdown path as finalized messages without leaving a raw duplicate behind.
   */
  streaming?: boolean;
}): React.JSX.Element {
  switch (item.kind) {
    case "intro":
      return (
        <Box flexDirection="column" marginY={1}>
          <IntroBanner
            theme={theme}
            provider={provider ?? "openai"}
            model={model ?? ""}
          />
        </Box>
      );
    case "user":
      return (
        <Box flexDirection="column" marginY={0.2}>
          <PromptBlock text={item.text} width={width} />
        </Box>
      );
    case "assistant":
      return (
        <Box flexDirection="column" marginY={0.2}>
          <Box flexDirection="row" marginBottom={0.1}>
            <Text bold color={theme.success}>● lucky</Text>
            <Text color={theme.muted}> › </Text>
          </Box>
          <Box paddingLeft={2}>
            {parseMarkdownToReact(item.text, theme)}
          </Box>
        </Box>
      );
    case "error":
      return (
        <Box flexDirection="column" marginY={0.2}>
          <Box flexDirection="row" marginBottom={0.1}>
            <Text bold color={theme.error}>▲ error</Text>
            <Text color={theme.muted}> › </Text>
          </Box>
          <Box paddingLeft={2}>
            <Text color={theme.error}>{item.text}</Text>
          </Box>
        </Box>
      );
    case "tool": {
      const isRunning = item.output === undefined;
      const toolColor = item.error ? theme.error : isRunning ? theme.accent : theme.success;
      const statusSymbol = item.error ? "✖" : isRunning ? "•" : "✔";
      const action = formatToolAction(item.name, item.input, isRunning, item.error);
      const result = item.output ? formatToolResultSummary(item.name, item.output, item.error) : "";
      return (
        <Box flexDirection="row" paddingLeft={2} marginY={0.1} gap={1}>
          <Text bold color={toolColor}>{statusSymbol}</Text>
          <Text bold color={toolColor} wrap="truncate-end">{truncateSingleLine(action, Math.max(24, width - 18))}</Text>
          {isRunning ? (
            <Text color={theme.accent}>...</Text>
          ) : result ? (
            <Text color={item.error ? theme.error : theme.muted} wrap="truncate-end">
              - {truncateSingleLine(result, Math.max(16, width - action.length - 12))}
            </Text>
          ) : null}
        </Box>
      );
    }
    case "status":
      return (
        <StatusView
          provider={item.provider}
          context={item.context}
          theme={theme}
          width={width}
        />
      );
    case "command":
      return (
        <Box flexDirection="column" paddingLeft={2} marginY={0.2}>
          <Text bold color={theme.accent}>ℹ {item.title}</Text>
          <Box flexDirection="column" paddingLeft={2} marginTop={0.1}>
            {item.rows.map((row, idx) => (
              <Box key={idx} flexDirection="row">
                <Text color={theme.muted}>{row.label.padEnd(12)}: </Text>
                <Text color="white">{row.value}</Text>
              </Box>
            ))}
          </Box>
        </Box>
      );
  }
}

function StatusView({
  provider,
  context,
  theme,
  width,
}: {
  provider: ProviderStatus;
  context: ContextStatus;
  theme: Theme;
  width: number;
}): React.JSX.Element {
  const panelWidth = Math.max(56, Math.min(width - 4, 112));
  const details = statusDetails(provider, context);
  const notes = compactStatusNotes(provider.notes ?? []);
  const contextUsage = contextUsagePercent(context);

  return (
    <Box flexDirection="column" marginY={0.4} paddingLeft={1}>
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={theme.muted}
        paddingX={2}
        paddingY={1}
        width={panelWidth}
      >
        <Box flexDirection="row" marginBottom={1}>
          <Text bold color={theme.accent}>›_ </Text>
          <Text bold>{provider.displayName}</Text>
          <Text color={theme.muted}> ({provider.provider})</Text>
        </Box>

        <Box flexDirection="column" marginBottom={1}>
          {details.map((row) => (
            <Box key={row.label} flexDirection="row">
              <Box width={15}>
                <Text color={theme.muted}>{row.label}:</Text>
              </Box>
              <Text color="white">{row.value}</Text>
              {row.hint ? <Text color={theme.muted}> {row.hint}</Text> : null}
            </Box>
          ))}
        </Box>

        <UsageBar
          label="Context"
          percent={contextUsage}
          unavailable={contextUsage === undefined}
          detail={contextDetail(context)}
          theme={theme}
          width={panelWidth - 8}
        />

        {provider.quotas?.length ? (
          <Box flexDirection="column" marginTop={1}>
            {provider.quotas.map((quota, index) => (
              <UsageBar
                key={`${quota.label}-${index}`}
                label={quotaLabel(quota.label)}
                percent={quotaUsedPercent(quota)}
                detail={quotaResetDetail(quota)}
                theme={theme}
                width={panelWidth - 8}
              />
            ))}
          </Box>
        ) : (
          <Box marginTop={1}>
            <Text color={theme.muted}>Quota windows not available from this provider.</Text>
          </Box>
        )}

        {notes.length ? (
          <Box flexDirection="column" marginTop={1}>
            {notes.map((note) => (
              <Text key={note} color={theme.muted}>{note}</Text>
            ))}
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

function UsageBar({
  label,
  percent,
  detail,
  unavailable,
  theme,
  width,
}: {
  label: string;
  percent: number | undefined;
  detail: string | undefined;
  unavailable?: boolean;
  theme: Theme;
  width: number;
}): React.JSX.Element {
  const barWidth = Math.max(18, Math.min(36, width - 25));
  const safePercent = percent === undefined ? 0 : Math.max(0, Math.min(100, percent));
  const filled = Math.round((safePercent / 100) * barWidth);
  const empty = Math.max(0, barWidth - filled);

  return (
    <Box flexDirection="column" marginTop={0.3}>
      <Text bold color="white">{label}</Text>
      <Box flexDirection="row">
        <Text color={theme.accent}>{"█".repeat(filled)}</Text>
        <Text color={theme.muted}>{"░".repeat(empty)}</Text>
        <Text color="white"> {unavailable ? "unknown" : `${safePercent}% used`}</Text>
        {detail ? <Text color={theme.muted}> {detail}</Text> : null}
      </Box>
    </Box>
  );
}

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

function inputString(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

interface Block {
  type: "paragraph" | "code" | "list" | "header";
  text: string;
  codeLines?: string[];
  language?: string;
  level?: number;
}

/**
 * Bound the live streaming preview to its tail. The full message is rendered
 * (with rich markdown) once it finalizes into a <Static> item, so the live
 * region only needs the most recent output — keeping each re-render cheap no
 * matter how large the reply grows. Cut on a line boundary to avoid a partial
 * first line.
 */
const STREAMING_TAIL_CHARS = 8_000;
const STREAMING_TAIL_LINES = 40;
function capStreamingTail(text: string): string {
  if (text.length <= STREAMING_TAIL_CHARS) return text;
  const tail = text.slice(text.length - STREAMING_TAIL_CHARS);
  const nl = tail.indexOf("\n");
  return nl >= 0 ? tail.slice(nl + 1) : tail;
}

/**
 * The text fed to the live markdown preview: the tail of the buffer, bounded by
 * both characters and lines. This keeps each streaming re-render O(viewport)
 * rather than O(whole reply) — the full message still lands in <Static> with
 * complete markdown once it finalizes.
 */
function streamingTail(text: string): string {
  const capped = capStreamingTail(text);
  const lines = capped.split("\n");
  if (lines.length <= STREAMING_TAIL_LINES) return capped;
  return lines.slice(lines.length - STREAMING_TAIL_LINES).join("\n");
}

function parseMessageIntoBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let currentCodeBlock: { language: string; lines: string[] } | null = null;

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (currentCodeBlock) {
        blocks.push({
          type: "code",
          text: "",
          codeLines: currentCodeBlock.lines,
          language: currentCodeBlock.language,
        });
        currentCodeBlock = null;
      } else {
        const lang = line.trim().slice(3).trim();
        currentCodeBlock = { language: lang || "code", lines: [] };
      }
      continue;
    }

    if (currentCodeBlock) {
      currentCodeBlock.lines.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      blocks.push({ type: "paragraph", text: "" });
      continue;
    }

    const headerMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headerMatch) {
      blocks.push({
        type: "header",
        text: headerMatch[2] ?? "",
        level: headerMatch[1]?.length ?? 1,
      });
      continue;
    }

    const listMatch = line.match(/^(\s*(?:[-*+]|\d+[.)])\s+)(.*)$/);
    if (listMatch) {
      blocks.push({
        type: "list",
        text: line,
      });
      continue;
    }

    blocks.push({
      type: "paragraph",
      text: line,
    });
  }

  if (currentCodeBlock) {
    blocks.push({
      type: "code",
      text: "",
      codeLines: currentCodeBlock.lines,
      language: currentCodeBlock.language,
    });
  }

  return blocks;
}

function parseInlineMarkdown(text: string, theme: Theme): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  const tokens = text.split(regex);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;

    if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(
        <Text key={i} bold color={theme.accent}>
          {token.slice(2, -2)}
        </Text>
      );
    } else if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(
        <Text key={i} color="yellow">
          {token.slice(1, -1)}
        </Text>
      );
    } else {
      parts.push(<Text key={i}>{token}</Text>);
    }
  }

  return parts.length > 0 ? parts : [text];
}

function pushWrappedLines(text: string, width: number): string[] {
  const output: string[] = [];
  pushWrapped(output, text, width);
  return output;
}

function highlightCodeLine(line: string, language: string, theme: Theme): React.ReactNode[] {
  const lowercaseLang = language.toLowerCase();
  
  let commentMatch = null;
  if (lowercaseLang === "python" || lowercaseLang === "bash" || lowercaseLang === "sh" || lowercaseLang === "yaml" || lowercaseLang === "dockerfile") {
    commentMatch = line.match(/^(.*?)(#.*)$/);
  } else {
    commentMatch = line.match(/^(.*?)(\/\/.*)$/);
  }
  
  if (commentMatch) {
    const codePart = commentMatch[1] ?? "";
    const commentPart = commentMatch[2] ?? "";
    return [
      ...highlightCodeCode(codePart, lowercaseLang, theme),
      <Text key="comment" color={theme.muted} italic>{commentPart}</Text>
    ];
  }
  
  return highlightCodeCode(line, lowercaseLang, theme);
}

function highlightCodeCode(code: string, language: string, theme: Theme): React.ReactNode[] {
  const keywords = /\b(const|let|var|function|return|import|export|from|class|extends|if|else|for|while|do|switch|case|break|continue|try|catch|finally|async|await|def|import|as|from|print|in|is|not|and|or|elif|try|except|with|lambda)\b/g;
  const builtins = /\b(string|number|boolean|any|void|unknown|never|null|undefined|true|false|self|this|Object|Array|Promise|console)\b/g;
  const numbers = /\b(\d+(?:\.\d+)?)\b/g;

  const stringRegex = /(["'`].*?["'`])/g;
  const stringTokens = code.split(stringRegex);
  const elements: React.ReactNode[] = [];

  stringTokens.forEach((token, idx) => {
    if ((token.startsWith('"') && token.endsWith('"')) ||
        (token.startsWith("'") && token.endsWith("'")) ||
        (token.startsWith("`") && token.endsWith("`"))) {
      elements.push(<Text key={`str-${idx}`} color="green">{token}</Text>);
    } else {
      const subTokens = token.split(/(\s+|\b)/);
      subTokens.forEach((subToken, subIdx) => {
        const key = `sub-${idx}-${subIdx}`;
        if (subToken.match(keywords)) {
          elements.push(<Text key={key} color={theme.primary} bold>{subToken}</Text>);
        } else if (subToken.match(builtins)) {
          elements.push(<Text key={key} color={theme.accent}>{subToken}</Text>);
        } else if (subToken.match(numbers)) {
          elements.push(<Text key={key} color="magenta">{subToken}</Text>);
        } else {
          elements.push(<Text key={key}>{subToken}</Text>);
        }
      });
    }
  });

  return elements;
}

function parseMarkdownToReact(text: string, theme: Theme): React.JSX.Element {
  const blocks = parseMessageIntoBlocks(text);

  return (
    <Box flexDirection="column">
      {blocks.map((block, blockIdx) => {
        if (block.type === "code" && block.codeLines) {
          return (
            <Box key={blockIdx} flexDirection="column" marginY={0.5} paddingLeft={2}>
              <Box marginBottom={0.2}>
                <Text bold dimColor color={theme.accent}>
                  ⌨ {block.language?.toUpperCase() || "CODE"}
                </Text>
              </Box>
              <Box flexDirection="column">
                {block.codeLines.map((line, lineIdx) => (
                  <Text key={lineIdx}>
                    {highlightCodeLine(line, block.language || "code", theme)}
                  </Text>
                ))}
              </Box>
            </Box>
          );
        }

        if (block.type === "header") {
          const headerPrefix = "#".repeat(block.level || 1) + " ";
          return (
            <Box key={blockIdx} marginY={0.5}>
              <Text bold underline color={theme.primary}>
                {headerPrefix}
                {block.text}
              </Text>
            </Box>
          );
        }

        if (block.type === "list") {
          return (
            <Box key={blockIdx} paddingLeft={2} marginY={0.1}>
              <Text>
                {parseInlineMarkdown(block.text, theme)}
              </Text>
            </Box>
          );
        }

        if (!block.text.trim()) {
          return <Box key={blockIdx} height={0.5} />;
        }

        return (
          <Box key={blockIdx} marginY={0.2}>
            <Text>
              {parseInlineMarkdown(block.text, theme)}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
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

/** Attach output to the most recent matching tool item. */
function patchLastTool(
  items: Item[],
  name: string,
  output: string,
  error: boolean,
): Item[] {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item && item.kind === "tool" && item.name === name && item.output === undefined) {
      const next = [...items];
      next[i] = { ...item, output, error };
      return next;
    }
  }
  return items;
}

function getModelPickerState(
  input: string,
  provider: ProviderId,
  activeModel: string,
): { open: boolean; query: string; items: string[] } {
  if (input !== "/model" && !input.startsWith("/model ")) {
    return { open: false, query: "", items: [] };
  }

  const query = input.slice("/model".length).trim().toLowerCase();
  const models = getAvailableModels(provider, activeModel);
  const items = query
    ? models.filter((model) => model.toLowerCase().includes(query))
    : models;
  return { open: true, query, items };
}

function getThemePickerState(
  input: string,
  activeThemeId: string,
): { open: boolean; query: string; items: Theme[] } {
  if (input !== "/theme" && !input.startsWith("/theme ")) {
    return { open: false, query: "", items: [] };
  }

  const query = input.slice("/theme".length).trim().toLowerCase();
  const themes = [...THEMES].sort((a, b) => {
    if (a.id === activeThemeId) return -1;
    if (b.id === activeThemeId) return 1;
    return 0;
  });
  const items = query
    ? themes.filter(
        (theme) =>
          theme.id.toLowerCase().includes(query) ||
          theme.name.toLowerCase().includes(query),
      )
    : themes;
  return { open: true, query, items };
}

function getAvailableModels(provider: ProviderId, activeModel?: string): string[] {
  const models = [...PROVIDER_CATALOG[provider].availableModels];
  if (activeModel && !models.includes(activeModel)) {
    models.unshift(activeModel);
  }
  return models;
}

function validateModel(
  provider: ProviderId,
  model: string,
): { ok: true } | { ok: false; message: string } {
  if (!model) return { ok: false, message: "model id cannot be empty" };
  const knownModels = getAvailableModels(provider);
  if (knownModels.includes(model)) return { ok: true };

  if (provider === "ollama") {
    return { ok: true };
  }

  return {
    ok: false,
    message: `unknown ${provider} model: ${model}. Use /model to pick one of: ${knownModels.join(", ")}`,
  };
}

function formatCommandRows(title: string, rows: CommandRow[]): string {
  const labelWidth = Math.max(
    title.length,
    ...rows.map((row) => row.label.length),
  );
  return [
    title,
    ...rows.map((row) => `${row.label.padEnd(labelWidth)}  ${row.value}`),
  ].join("\n");
}

function contextRows(status: ContextStatus): CommandRow[] {
  return [
    { label: "model", value: status.model },
    {
      label: "window",
      value: status.contextWindow ? `${formatNumber(status.contextWindow)} tokens` : "unknown",
    },
    {
      label: "usable",
      value: status.usableTokens ? `${formatNumber(status.usableTokens)} tokens` : "unknown",
    },
    {
      label: "input cap",
      value: status.maxInputTokens ? `${formatNumber(status.maxInputTokens)} tokens` : "not specified",
    },
    {
      label: "used",
      value: status.usedTokens ? `${formatNumber(status.usedTokens)} tokens` : "not available",
    },
    {
      label: "remaining",
      value: status.remainingPercentage !== undefined ? `${status.remainingPercentage}%` : "unknown",
    },
    {
      label: "turn",
      value:
        status.currentInputTokens !== undefined
          ? `${formatNumber(status.currentInputTokens)} in / ${formatNumber(status.currentOutputTokens ?? 0)} out`
          : "not available",
    },
    {
      label: "total",
      value:
        status.totalInputTokens !== undefined
          ? `${formatNumber(status.totalInputTokens)} in / ${formatNumber(status.totalOutputTokens ?? 0)} out`
          : "not available",
    },
    {
      label: "pressure",
      value: status.usedPercentage !== undefined ? `${status.usedPercentage}%` : status.ratio !== undefined ? `${Math.round(status.ratio * 100)}%` : "unknown",
    },
    { label: "counter", value: status.tokenCounter },
    { label: "source", value: status.source ?? "unknown" },
  ];
}

function statusDetails(
  provider: ProviderStatus,
  context: ContextStatus,
): Array<{ label: string; value: string; hint?: string }> {
  return [
    { label: "Model", value: context.model },
    { label: "Directory", value: prettyCwd(process.cwd()) },
    { label: "Login", value: provider.authType },
    {
      label: "Account",
      value: provider.account ?? "not available",
      hint: provider.subscription ? `(${provider.subscription})` : undefined,
    },
    ...(provider.project ? [{ label: "Project", value: provider.project }] : []),
    ...(provider.tier ? [{ label: "Tier", value: provider.tier }] : []),
  ];
}

function compactStatusNotes(notes: string[]): string[] {
  return notes
    .filter((note) => !note.startsWith("subscription status:"))
    .filter((note) => !note.startsWith("billing:"))
    .filter((note) => note !== "extra usage enabled")
    .map((note) => note.replace(/^organization role: /, "role: "))
    .slice(0, 4);
}

function contextUsagePercent(context: ContextStatus): number | undefined {
  if (typeof context.ratio !== "number" || !Number.isFinite(context.ratio)) return undefined;
  return Math.round(Math.max(0, Math.min(1, context.ratio)) * 100);
}

function contextDetail(context: ContextStatus): string | undefined {
  if (context.usedTokens !== undefined && context.usableTokens) {
    return `(${formatNumber(context.usedTokens)} / ${formatNumber(context.usableTokens)})`;
  }
  if (context.contextWindow) return `(${formatNumber(context.contextWindow)} window)`;
  return undefined;
}

function quotaUsedPercent(quota: ProviderQuotaStatus): number | undefined {
  const match = quota.remaining?.match(/\((\d+)% used\)/);
  if (match?.[1]) return Number(match[1]);
  const remainingMatch = quota.remaining?.match(/^(\d+)% available/);
  if (remainingMatch?.[1]) return 100 - Number(remainingMatch[1]);
  return undefined;
}

function quotaResetDetail(quota: ProviderQuotaStatus): string | undefined {
  if (!quota.resetTime) return quota.modelId ? `(model ${quota.modelId})` : undefined;
  const reset = new Date(quota.resetTime);
  const formatted = Number.isNaN(reset.getTime())
    ? quota.resetTime
    : reset.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
  return `(resets ${formatted}${quota.modelId ? ` · ${quota.modelId}` : ""})`;
}

function quotaLabel(label: string): string {
  switch (label) {
    case "5h limit":
      return "Current session";
    case "weekly limit":
      return "Current week";
    default:
      return label;
  }
}

function formatStatusFooter(
  status: ContextStatus | null,
  fallbackUsage: { input: number; output: number },
): string {
  const totalInput = status?.totalInputTokens ?? fallbackUsage.input;
  const totalOutput = status?.totalOutputTokens ?? fallbackUsage.output;
  const current =
    status?.currentInputTokens !== undefined
      ? `turn: ${formatNumber(status.currentInputTokens)} in / ${formatNumber(status.currentOutputTokens ?? 0)} out`
      : "turn: n/a";
  return `ctx: ${formatContextFooter(status)} ┃ ${current} ┃ total: ${formatNumber(totalInput)} in / ${formatNumber(totalOutput)} out`;
}

function formatContextFooter(status: ContextStatus | null): string {
  if (!status) return "unknown";
  if (status.usedTokens !== undefined && status.usableTokens) {
    const used = status.usedPercentage ?? Math.round((status.ratio ?? 0) * 100);
    const remaining = status.remainingPercentage ?? Math.max(0, 100 - used);
    return `${remaining}% free (${used}% used) · ${formatNumber(status.usedTokens)}/${formatNumber(status.usableTokens)}`;
  }
  if (status.contextWindow) return `window ${formatNumber(status.contextWindow)} | counter ${status.tokenCounter}`;
  return "unknown";
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function preview(value: unknown, max = 120): string {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function formatToolAction(
  name: string,
  input: unknown,
  running: boolean,
  error?: boolean,
): string {
  const verb = toolVerb(name, running, error);
  const target = toolTarget(name, input);
  return target ? `${verb} ${target}` : verb;
}

function toolVerb(name: string, running: boolean, error?: boolean): string {
  if (error) return `Failed ${name}`;
  const pair: readonly [string, string] = (() => {
    switch (name) {
      case "exec":
      case "PowerShell":
        return ["Run", "Ran"];
      case "read_file":
        return ["Read", "Read"];
      case "write_file":
        return ["Write", "Wrote"];
      case "edit_file":
        return ["Edit", "Edited"];
      case "apply_patch":
        return ["Apply patch", "Applied patch"];
      case "list_dir":
        return ["List", "Listed"];
      case "glob":
        return ["Find", "Found"];
      case "grep":
        return ["Search", "Searched"];
      case "http_fetch":
        return ["Fetch", "Fetched"];
      case "todo_write":
        return ["Update todos", "Updated todos"];
      case "project_memory":
        return ["Remember", "Remembered"];
      case "ask_user":
        return ["Ask user", "Asked user"];
      default:
        return ["Run tool", "Ran tool"];
    }
  })();
  return running ? pair[0] : pair[1];
}

function toolTarget(name: string, input: unknown): string {
  const command = inputString(input, "command");
  if ((name === "exec" || name === "PowerShell") && command) return command;

  const path = inputString(input, "path");
  if (["read_file", "write_file", "edit_file", "list_dir"].includes(name) && path) {
    return quotePath(path);
  }

  if (name === "grep") {
    const pattern = inputString(input, "pattern");
    const include = inputString(input, "include");
    return [pattern ? quotePath(pattern) : "", include ? `in ${include}` : ""]
      .filter(Boolean)
      .join(" ");
  }

  if (name === "glob") {
    const pattern = inputString(input, "pattern");
    return pattern ? quotePath(pattern) : "";
  }

  if (name === "http_fetch") {
    return inputString(input, "url") ?? "";
  }

  if (name === "apply_patch") {
    const patch = inputString(input, "patch");
    return patch ? patchTargets(patch).join(", ") : "";
  }

  if (name === "todo_write") {
    return todoSummary(input);
  }

  if (name === "project_memory") {
    return inputString(input, "operation") ?? ".lucky/memory.md";
  }

  if (name === "ask_user") {
    return inputString(input, "question") ?? "";
  }

  return preview(input, 120);
}

function formatToolResultSummary(name: string, output: string, error?: boolean): string {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return "";
  if (error) return firstUsefulLine(lines);

  switch (name) {
    case "exec":
    case "PowerShell":
      return firstUsefulLine(lines);
    case "read_file":
      return summarizeReadOutput(lines);
    case "list_dir":
      return `${lines.length} entries`;
    case "glob":
      return lines[0]?.startsWith("[no files") ? "no matches" : `${lines.length} files`;
    case "grep":
      return lines[0]?.startsWith("[no matches") ? "no matches" : `${lines.length} matches`;
    case "write_file":
    case "edit_file":
    case "apply_patch":
    case "todo_write":
    case "project_memory":
    case "ask_user":
    case "http_fetch":
      return firstUsefulLine(lines);
    default:
      return firstUsefulLine(lines);
  }
}

function summarizeReadOutput(lines: string[]): string {
  const rangeLine = lines.find((line) => /^\[showing \d+ of \d+ lines\]$/.test(line));
  if (rangeLine) return rangeLine.replace(/^\[|\]$/g, "");
  const noLines = lines.find((line) => line.startsWith("[no lines"));
  if (noLines) return noLines.replace(/^\[|\]$/g, "");
  return `${lines.length} lines`;
}

function firstUsefulLine(lines: string[]): string {
  return lines.find((line) => !line.startsWith("[command failed:")) ?? lines[0] ?? "";
}

function quotePath(path: string): string {
  return `"${path}"`;
}

function patchTargets(patch: string): string[] {
  const targets = new Set<string>();
  for (const line of patch.split("\n")) {
    const match = /^\+\+\+\s+(?:b\/)?(.+)$/.exec(line);
    if (!match) continue;
    const target = match[1];
    if (!target || target === "/dev/null") continue;
    targets.add(quotePath(target));
  }
  return [...targets].slice(0, 3);
}

function todoSummary(input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  const todos = (input as Record<string, unknown>).todos;
  if (!Array.isArray(todos)) return "";
  const counts = new Map<string, number>();
  for (const todo of todos) {
    if (!todo || typeof todo !== "object" || Array.isArray(todo)) continue;
    const status = (todo as Record<string, unknown>).status;
    if (typeof status === "string") counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const parts = [...counts.entries()].map(([status, count]) => `${count} ${status}`);
  return parts.length ? parts.join(", ") : `${todos.length} items`;
}

function truncateSingleLine(value: string, max: number): string {
  const safeMax = Math.max(8, max);
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > safeMax ? `${flat.slice(0, safeMax - 1)}…` : flat;
}

/**
 * Rebuild the scrollback transcript from a resumed session's canonical
 * messages. Tool calls and their results are stitched back together by id.
 */
function messagesToItems(messages: Message[]): Item[] {
  const items: Item[] = [];
  const toolIndexById = new Map<string, number>();

  for (const message of messages) {
    const assistantMessageHasToolCall =
      message.role === "assistant" &&
      message.content.some((part) => part.type === "tool_call");
    for (const part of message.content) {
      if (part.type === "text") {
        const text = part.text.trim();
        if (!text) continue;
        if (message.role === "user") items.push({ kind: "user", text });
        else if (message.role === "assistant" && !assistantMessageHasToolCall) {
          items.push({ kind: "assistant", text });
        }
        // system summaries (from compaction) are context only — skip in the UI
      } else if (part.type === "tool_call") {
        toolIndexById.set(part.id, items.length);
        items.push({ kind: "tool", name: part.name, input: part.arguments });
      } else if (part.type === "tool_result") {
        const index = toolIndexById.get(part.toolCallId);
        const target = index !== undefined ? items[index] : undefined;
        if (target && target.kind === "tool") {
          target.output = part.content;
          if (part.isError) target.error = true;
        }
      }
    }
  }

  return items;
}

function wrapText(text: string, width: number): string[] {
  const safeWidth = Math.max(16, width);
  const output: string[] = [];
  let inCodeBlock = false;

  for (const rawLine of text.split("\n")) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      pushWrapped(output, `  ${rawLine.replace(/\t/g, "  ")}`, safeWidth);
      continue;
    }

    if (!trimmed) {
      output.push("");
      continue;
    }

    const listMatch = rawLine.match(/^(\s*(?:[-*+]|\d+[.)])\s+)(.*)$/);
    if (listMatch) {
      const prefix = listMatch[1] ?? "";
      const body = stripInlineMarkdown(listMatch[2] ?? "");
      pushWrapped(output, `${prefix}${body}`, safeWidth, " ".repeat(prefix.length));
      continue;
    }

    pushWrapped(output, stripInlineMarkdown(trimmed), safeWidth);
  }

  return output.length > 0 ? output : [""];
}

function pushWrapped(
  output: string[],
  text: string,
  width: number,
  continuationPrefix = "",
): void {
  if (text.length <= width) {
    output.push(text);
    return;
  }

  const firstPrefixLength = Math.max(0, text.length - text.trimStart().length);
  const firstPrefix = " ".repeat(firstPrefixLength);
  let prefix = firstPrefix;
  let rest = text.trimStart();

  while (rest.length > 0) {
    const available = Math.max(8, width - prefix.length);
    if (rest.length <= available) {
      output.push(`${prefix}${rest}`);
      return;
    }

    let splitAt = rest.lastIndexOf(" ", available);
    if (splitAt <= 0) splitAt = available;
    output.push(`${prefix}${rest.slice(0, splitAt).trimEnd()}`);
    rest = rest.slice(splitAt).trimStart();
    prefix = continuationPrefix || firstPrefix;
  }
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

function humanizeError(message: string): string {
  if (!message.includes("Code Assist request failed")) return message;

  const statusMatch = message.match(/Code Assist request failed \((\d+)\)/);
  const resetMatch = message.match(/reset after\s+(\d+s)/i);
  const modelMatch = message.match(/"model":"([^"]+)"/);
  const status = statusMatch?.[1];

  if (status === "429") {
    return [
      "Code Assist quota exhausted",
      modelMatch ? `for ${modelMatch[1]}` : "",
      resetMatch ? `retry in ${resetMatch[1]}` : "",
    ].filter(Boolean).join(" | ");
  }

  return message;
}

import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import os from "node:os";
import React, { useCallback, useState, useEffect, useRef } from "react";
import {
  PROVIDER_CATALOG,
  type Agent,
  type AgentEvent,
  type ContextStatus,
  type Message,
  type ProviderStatus,
  type ProviderId,
  type Session,
  type ToolApproval,
  type TokenUsage,
  createSessionId,
  deriveTitle,
  listSessions,
  loadStoredConfig,
  saveSession,
  saveStoredConfig,
} from "@luckycli/core";

/** Shown in the opening banner. Keep in sync with packages/cli/package.json. */
const APP_VERSION = "0.1.0";

interface AppMeta {
  provider: ProviderId;
  model: string;
}

/** A line in the scrollback transcript. */
type Item =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; name: string; input: string; output?: string; error?: boolean }
  | { kind: "command"; title: string; rows: CommandRow[] }
  | { kind: "error"; text: string };

interface CommandRow {
  label: string;
  value: string;
}

export interface ApprovalRequest {
  name: string;
  input: unknown;
  resolve: (decision: ToolApproval) => void;
}

interface AppProps {
  agent: Agent;
  meta: AppMeta;
  approvalRequest: ApprovalRequest | null;
  setApprovalRequest: (req: ApprovalRequest | null) => void;
  onTriggerSetup: () => void;
  onChangeModel: (model: string) => void;
  onTriggerResume: () => void;
  /** A session loaded via --continue/--resume, replayed into the transcript. */
  resumed?: Session;
}

interface Theme {
  id: string;
  name: string;
  primary: string;
  success: string;
  accent: string;
  warning: string;
  muted: string;
  error: string;
}

const THEMES: Theme[] = [
  { id: "matrix", name: "Digital Matrix (CRT)", primary: "#00ff00", accent: "#008f11", success: "#00ff00", warning: "#ffff00", muted: "#003300", error: "#ff0000" },
  { id: "amber", name: "DEC Amber Mainframe", primary: "#ffb000", accent: "#ff8000", success: "#ffb000", warning: "#ff4500", muted: "#553300", error: "#ff0000" },
  { id: "cyberpunk", name: "Netrunner Deck 2077", primary: "#fcee0a", accent: "#00f0ff", success: "#39ff14", warning: "#ff0055", muted: "#555555", error: "#ff0055" },
  { id: "dracula", name: "Dracula Tactical", primary: "#ff79c6", accent: "#bd93f9", success: "#50fa7b", warning: "#f1fa8c", muted: "#6272a4", error: "#ff5555" },
  { id: "nord", name: "Tactical Frost Node", primary: "#88c0d0", accent: "#81a1c1", success: "#a3be8c", warning: "#ebcb8b", muted: "#4c566a", error: "#bf616a" },
  { id: "minimal", name: "Legacy Monochrome", primary: "white", accent: "gray", success: "white", warning: "white", muted: "gray", error: "white" }
];

const ALL_SLASH_COMMANDS = [
  { name: "/help", desc: "Show all available slash commands" },
  { name: "/model", desc: "Switch model for the active provider" },
  { name: "/status", desc: "Show provider auth, account, quota and context status" },
  { name: "/context", desc: "Show model context window and usage" },
  { name: "/compact", desc: "Summarize older chat history now" },
  { name: "/sessions", desc: "List saved sessions (resume with: lucky --resume <id>)" },
  { name: "/resume", desc: "Pick a saved session to resume" },
  { name: "/setup", desc: "Switch model provider or change settings" },
  { name: "/provider", desc: "Alias for /setup" },
  { name: "/config", desc: "Show active provider and model info" },
  { name: "/theme", desc: "Choose terminal UI colors" },
  { name: "/exit", desc: "Exit the lucky agent session" },
  { name: "/quit", desc: "Alias for /exit" },
];

export function App({
  agent,
  meta,
  approvalRequest,
  setApprovalRequest,
  onTriggerSetup,
  onChangeModel,
  onTriggerResume,
  resumed,
}: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const [items, setItems] = useState<Item[]>(() =>
    resumed ? messagesToItems(resumed.messages) : [],
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
  const [scrollOffset, setScrollOffset] = useState(0);
  const handleInputChange = useCallback((val: string) => {
    setInput(val);
    setScrollOffset(0);
  }, []);
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [busyFrame, setBusyFrame] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Persistent Theme System
  const [activeTheme, setActiveTheme] = useState<Theme>(() => {
    try {
      const cfg = loadStoredConfig();
      const storedTheme = THEMES.find((t) => t.id === cfg.theme);
      return storedTheme ?? (THEMES[0] as Theme);
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
    if (!busy || startedAt === null) {
      setElapsedSeconds(0);
      return;
    }
    const timer = setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 500);
    return () => clearInterval(timer);
  }, [busy, startedAt]);

  useEffect(() => {
    if (!busy) {
      setBusyFrame(0);
      return;
    }
    const timer = setInterval(() => {
      setBusyFrame((frame) => frame + 1);
    }, 200);
    return () => clearInterval(timer);
  }, [busy]);

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

  useEffect(() => {
    setSelectedModelIndex(0);
  }, [modelPicker.query, meta.provider]);

  useEffect(() => {
    setSelectedThemeIndex(0);
  }, [themePicker.query]);

  useEffect(() => {
    setSelectedApprovalIndex(0);
  }, [approvalRequest]);

  // Ctrl+C exits when idle. Support autocomplete and tool approval.
  useInput((_in, key) => {
    // 1. Tool safety approval has highest precedence
    if (approvalRequest) {
      if (key.ctrl && _in === "c") {
        approvalRequest.resolve("deny");
        setApprovalRequest(null);
        abortControllerRef.current?.abort();
        return;
      }
      if (key.leftArrow || _in === "h") {
        setSelectedApprovalIndex(
          (prev) => (prev - 1 + approvalOptions.length) % approvalOptions.length,
        );
        return;
      }
      if (key.rightArrow || _in === "l" || key.tab) {
        setSelectedApprovalIndex((prev) => (prev + 1) % approvalOptions.length);
        return;
      }
      if (key.return) {
        approvalRequest.resolve(approvalOptions[selectedApprovalIndex] ?? "deny");
        setApprovalRequest(null);
        return;
      }
      if (key.escape) {
        approvalRequest.resolve("deny");
        setApprovalRequest(null);
      }
      return;
    }

    // 2. Interactive model picker navigation
    if (modelPicker.open && modelPicker.items.length > 0) {
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
    if (themePicker.open && themePicker.items.length > 0) {
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
      showSlashMenu &&
      filteredCommands.length > 0
    ) {
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

    // 4b. Interactive Scrollback (when idle and no pickers/menus are active)
    if (
      !busy &&
      !approvalRequest &&
      !modelPicker.open &&
      !themePicker.open &&
      !showSlashMenu
    ) {
      if (key.upArrow || key.pageUp) {
        setScrollOffset((prev) => Math.min(items.length - 1, prev + 1));
        return;
      }
      if (key.downArrow || key.pageDown) {
        setScrollOffset((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.escape) {
        setScrollOffset(0);
        return;
      }
    }

    // 5. Regular Ctrl+C exit
    if (key.ctrl && _in === "c" && busy) {
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
              kind: "command",
              title: "Status",
              rows: statusRows(providerStatus, status),
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
            title: "Setup",
            rows: [{ label: "action", value: "opening provider setup" }],
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
      const flushAssistant = () => {
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
              setStreaming(assistantBuf);
            },
            onToolStart: (name, rawInput) => {
              flushAssistant();
              setItems((prev) => [
                ...prev,
                { kind: "tool", name, input: preview(rawInput) },
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
          });
        }
      } finally {
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
    [agent, busy, meta, exit, activeTheme.id, contextStatus, onTriggerSetup, onTriggerResume, selectModel, selectTheme, persistSession],
  );
  // Render the entire chat transcript inline to leverage native terminal scrollback
  const visibleItems = items;
  const hiddenItemsAbove = 0;
  const hiddenItemsBelow = 0;
  
  const status = approvalRequest ? "approval required" : busy ? `thinking ${elapsedSeconds}s` : "ready";
  const messageWidth = Math.max(32, terminalSize.width - 16);
  const thinkingFrames = ["-", "\\", "|", "/"];
  const thinkingFrame = thinkingFrames[busyFrame % thinkingFrames.length] ?? "-";
  const thinkingDots = ".".repeat((busyFrame % 4) + 1).padEnd(4, " ");

  return (
    <Box flexDirection="column" width={terminalSize.width} paddingX={1} paddingY={0}>
      <Box flexDirection="column" marginY={0.5}>
        {visibleItems.length === 0 && !streaming && !busy ? (
          <Box flexDirection="column" marginY={1}>
            <IntroBanner
              theme={activeTheme}
              provider={meta.provider}
              model={meta.model}
            />
            <Box marginTop={1}>
              <Text color={activeTheme.muted}>
                lucky › Input instruction payload or type / for command directory...
              </Text>
            </Box>
          </Box>
        ) : null}
        
        {visibleItems.map((item, i) => (
          <Box key={i} marginY={0.5}>
            <ItemView item={item} theme={activeTheme} width={messageWidth} />
          </Box>
        ))}
        
        {streaming ? (
          <Box marginY={0.5}>
            <ItemView
              item={{ kind: "assistant", text: streaming }}
              theme={activeTheme}
              width={messageWidth}
            />
          </Box>
        ) : busy && !approvalRequest ? (
          <Box marginY={0.5}>
            <Text color={activeTheme.muted}>
              ● lucky › thinking... ({elapsedSeconds}s elapsed)
            </Text>
          </Box>
        ) : null}
      </Box>

      {approvalRequest ? (
        <Box flexDirection="column" paddingLeft={2} marginY={0.5}>
          <Text bold color={activeTheme.warning}>⚠️ Permission Required</Text>
          <Text>{approvalSummary(approvalRequest)}</Text>
          <Box marginLeft={2} marginY={0.2}>
            <Text color={activeTheme.muted}>{approvalDetails(approvalRequest)}</Text>
          </Box>
          <Box flexDirection="row" gap={1} marginTop={0.5}>
            {approvalOptions.map((option, index) => (
              <ApprovalOptionView
                key={option}
                option={option}
                selected={index === selectedApprovalIndex}
                theme={activeTheme}
              />
            ))}
          </Box>
          <Text color={activeTheme.muted}>left/right select | enter confirm | esc reject</Text>
        </Box>
      ) : null}

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
        </Box>
      ) : null}

      <Box flexDirection="column" width="100%" marginTop={0.5}>
        <Text color={activeTheme.muted}>{"─".repeat(terminalSize.width - 2)}</Text>
        <Box
          flexDirection="row"
          paddingX={0}
          width="100%"
          marginY={0.1}
        >
          <Text bold color={busy ? activeTheme.success : activeTheme.accent}>
            {busy ? " ⏳ " : " > "}
          </Text>
          <TextInput value={input} onChange={handleInputChange} onSubmit={submit} />
        </Box>
        <Text color={activeTheme.muted}>{"─".repeat(terminalSize.width - 2)}</Text>
      </Box>

      <Box width="100%" paddingX={0} justifyContent="space-between" marginTop={0.2}>
        <Box flexDirection="row" gap={1}>
          {busy && (
            <Text color={activeTheme.muted}>
              ⏳ thinking for {elapsedSeconds}s...
            </Text>
          )}
          {scrollOffset > 0 && (
            <Text bold color={activeTheme.warning}>
              📜 scrollback: {scrollOffset} msgs up (esc to reset)
            </Text>
          )}
        </Box>
        <Box flexDirection="row" gap={1}>
          <Text color={activeTheme.muted} dimColor>
            tokens: {tokenUsage.input + tokenUsage.output} ({tokenUsage.input} in / {tokenUsage.output} out) ┃ ctx: {formatContextFooter(contextStatus)}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

/** Lucky's pixel mascot, drawn with block-glyphs (all single-width). */
const MASCOT = [
  "▛▀▀▀▀▀▀▀▜",
  "▌ ▆   ▆ ▐",
  "▌       ▐",
  "▙▄▄▄▄▄▄▄▟",
  "  ▘ ▘ ▘  ",
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
              <Text key={i} color={theme.accent}>
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

function ItemView({
  item,
  theme,
  width,
}: {
  item: Item;
  theme: Theme;
  width: number;
}): React.JSX.Element {
  switch (item.kind) {
    case "user":
      return (
        <Box flexDirection="column" marginY={0.2}>
          <Box flexDirection="row" marginBottom={0.1}>
            <Text bold color={theme.accent}>› </Text>
          </Box>
          <Box paddingLeft={2}>
            {parseMarkdownToReact(item.text, theme)}
          </Box>
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
      const toolColor = item.error ? theme.error : theme.muted;
      const statusSymbol = item.error ? "❌" : isRunning ? "⎔" : "✔";
      return (
        <Box flexDirection="row" paddingLeft={2} marginY={0.1} gap={1}>
          <Text color={toolColor}>{statusSymbol}</Text>
          <Text dimColor={!item.error} color={toolColor} italic>
            tool call: {item.name}({item.input}) {isRunning ? "..." : ""}
          </Text>
        </Box>
      );
    }
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
  const color = option === "deny" ? theme.error : option === "always" ? theme.accent : theme.success;
  return (
    <Box paddingX={1}>
      <Text bold={selected} color={selected ? color : theme.muted}>
        {selected ? "[ " : "  "}
        {label}
        {selected ? " ]" : "  "}
      </Text>
    </Box>
  );
}

function approvalSummary(request: ApprovalRequest): string {
  if (request.name === "exec") {
    const command = inputString(request.input, "command");
    return command ? `Run shell command: ${command}` : "Run shell command";
  }
  if (request.name === "edit_file") {
    const path = inputString(request.input, "path");
    return path ? `Edit file: ${path}` : "Edit file";
  }
  if (request.name === "write_file") {
    const path = inputString(request.input, "path");
    return path ? `Write file: ${path}` : "Write file";
  }
  return `Run tool: ${request.name}`;
}

function approvalDetails(request: ApprovalRequest): string {
  const raw = JSON.stringify(request.input, null, 2) ?? "";
  const details = raw.length > 1200 ? `${raw.slice(0, 1200)}\n[truncated]` : raw;
  return [
    details,
    "",
    "Allow always applies to this exact tool request for the current session.",
  ].join("\n");
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
      h.onToolEnd(event.name, preview(event.content), event.isError);
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
      label: "pressure",
      value: status.ratio !== undefined ? `${Math.round(status.ratio * 100)}%` : "unknown",
    },
    { label: "counter", value: status.tokenCounter },
    { label: "source", value: status.source ?? "unknown" },
  ];
}

function statusRows(
  provider: ProviderStatus,
  context: ContextStatus,
): CommandRow[] {
  const rows: CommandRow[] = [
    { label: "provider", value: `${provider.displayName} (${provider.provider})` },
    { label: "login", value: provider.authType },
    { label: "account", value: provider.account ?? "not available" },
    { label: "project", value: provider.project ?? "not applicable" },
    { label: "subscription", value: provider.subscription ?? "not available" },
    { label: "tier", value: provider.tier ?? "not available" },
    {
      label: "context",
      value:
        context.usedTokens !== undefined && context.usableTokens
          ? `${formatNumber(context.usedTokens)} / ${formatNumber(context.usableTokens)} tokens`
          : context.contextWindow
            ? `${formatNumber(context.contextWindow)} token window`
            : "unknown",
    },
    {
      label: "ctx pressure",
      value: context.ratio !== undefined ? `${Math.round(context.ratio * 100)}%` : "unknown",
    },
  ];

  if (provider.quotas?.length) {
    rows.push(
      ...provider.quotas.map((quota) => ({
        label: "quota",
        value: [
          quota.label,
          quota.remaining ? `remaining ${quota.remaining}` : undefined,
          quota.resetTime ? `resets ${quota.resetTime}` : undefined,
          quota.modelId ? `model ${quota.modelId}` : undefined,
        ]
          .filter(Boolean)
          .join(" | "),
      })),
    );
  } else {
    rows.push(
      { label: "5h limit", value: "not available" },
      { label: "weekly limit", value: "not available" },
    );
  }

  if (provider.notes?.length) {
    rows.push(
      ...provider.notes.map((note) => ({
        label: "note",
        value: note,
      })),
    );
  }

  return rows;
}

function formatContextFooter(status: ContextStatus | null): string {
  if (!status) return "unknown";
  if (status.usedTokens !== undefined && status.usableTokens) {
    return `${formatNumber(status.usedTokens)}/${formatNumber(status.usableTokens)} ${Math.round(status.ratio ?? 0)}%`;
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

/**
 * Rebuild the scrollback transcript from a resumed session's canonical
 * messages. Tool calls and their results are stitched back together by id.
 */
function messagesToItems(messages: Message[]): Item[] {
  const items: Item[] = [];
  const toolIndexById = new Map<string, number>();

  for (const message of messages) {
    for (const part of message.content) {
      if (part.type === "text") {
        const text = part.text.trim();
        if (!text) continue;
        if (message.role === "user") items.push({ kind: "user", text });
        else if (message.role === "assistant") items.push({ kind: "assistant", text });
        // system summaries (from compaction) are context only — skip in the UI
      } else if (part.type === "tool_call") {
        toolIndexById.set(part.id, items.length);
        items.push({ kind: "tool", name: part.name, input: preview(part.arguments) });
      } else if (part.type === "tool_result") {
        const index = toolIndexById.get(part.toolCallId);
        const target = index !== undefined ? items[index] : undefined;
        if (target && target.kind === "tool") {
          target.output = preview(part.content, 200);
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

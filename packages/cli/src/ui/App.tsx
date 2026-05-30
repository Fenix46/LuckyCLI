import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import React, { useCallback, useState, useEffect, useRef } from "react";
import {
  PROVIDER_CATALOG,
  type Agent,
  type AgentEvent,
  type ContextStatus,
  type Message,
  type ProviderId,
  type Session,
  type TokenUsage,
  createSessionId,
  deriveTitle,
  listSessions,
  loadStoredConfig,
  saveSession,
  saveStoredConfig,
} from "@luckycli/core";

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
  resolve: (approved: boolean) => void;
}

interface AppProps {
  agent: Agent;
  meta: AppMeta;
  approvalRequest: ApprovalRequest | null;
  setApprovalRequest: (req: ApprovalRequest | null) => void;
  onTriggerSetup: () => void;
  onChangeModel: (model: string) => void;
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
  { id: "neon", name: "Neon Cyan", primary: "cyan", accent: "blue", success: "green", warning: "yellow", muted: "gray", error: "red" },
  { id: "cyberpunk", name: "Cyberpunk", primary: "yellow", accent: "cyan", success: "green", warning: "red", muted: "gray", error: "red" },
  { id: "dracula", name: "Dracula", primary: "magenta", accent: "red", success: "green", warning: "yellow", muted: "gray", error: "red" },
  { id: "matrix", name: "Matrix", primary: "green", accent: "green", success: "green", warning: "yellow", muted: "gray", error: "red" },
  { id: "minimal", name: "Minimal", primary: "white", accent: "gray", success: "white", warning: "white", muted: "gray", error: "white" }
];

const ALL_SLASH_COMMANDS = [
  { name: "/help", desc: "Show all available slash commands" },
  { name: "/model", desc: "Switch model for the active provider" },
  { name: "/context", desc: "Show model context window and usage" },
  { name: "/compact", desc: "Summarize older chat history now" },
  { name: "/sessions", desc: "List saved sessions (resume with: lucky --resume <id>)" },
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

  useEffect(() => {
    setSelectedModelIndex(0);
  }, [modelPicker.query, meta.provider]);

  useEffect(() => {
    setSelectedThemeIndex(0);
  }, [themePicker.query]);

  // Ctrl+C exits when idle. Support autocomplete and tool approval.
  useInput((_in, key) => {
    // 1. Tool safety approval has highest precedence
    if (approvalRequest) {
      if (key.ctrl && _in === "c") {
        approvalRequest.resolve(false);
        setApprovalRequest(null);
        abortControllerRef.current?.abort();
        return;
      }
      if (_in === "y" || _in === "Y") {
        approvalRequest.resolve(true);
        setApprovalRequest(null);
      } else if (_in === "n" || _in === "N" || key.escape) {
        approvalRequest.resolve(false);
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
      if (text === "/compact") {
        try {
          const result = await agent.compactNow();
          const status = await agent.contextStatus();
          setContextStatus(status);
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
    [agent, busy, meta, exit, activeTheme.id, contextStatus, onTriggerSetup, selectModel, selectTheme, persistSession],
  );

  const transcriptHeight = Math.max(6, terminalSize.height - 10);
  const visibleItems = items.slice(-transcriptHeight);
  const hiddenItems = items.length - visibleItems.length;
  const status = approvalRequest ? "approval required" : busy ? `thinking ${elapsedSeconds}s` : "ready";
  const messageWidth = Math.max(32, terminalSize.width - 16);
  const thinkingFrames = ["-", "\\", "|", "/"];
  const thinkingFrame = thinkingFrames[busyFrame % thinkingFrames.length] ?? "-";
  const thinkingDots = ".".repeat((busyFrame % 4) + 1).padEnd(4, " ");

  return (
    <Box flexDirection="column" width={terminalSize.width} paddingX={1} paddingY={0}>
      <Box
        borderStyle="single"
        borderColor={activeTheme.accent}
        paddingX={1}
        justifyContent="space-between"
        width="100%"
      >
        <Text bold color={activeTheme.accent}>LuckyCLI</Text>
        <Text color={activeTheme.muted}>
          {meta.provider} / {meta.model}
        </Text>
      </Box>

      <Box flexDirection="column" marginY={1} minHeight={Math.min(transcriptHeight, 8)}>
        {hiddenItems > 0 ? (
          <Box marginBottom={1}>
            <Text color={activeTheme.muted}>... {hiddenItems} older message{hiddenItems === 1 ? "" : "s"} hidden</Text>
          </Box>
        ) : null}
        {visibleItems.length === 0 && !streaming && !busy ? (
          <Box marginY={1}>
            <Text color={activeTheme.muted}>Type a prompt, or use / for commands.</Text>
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
              lucky    {thinkingFrame} thinking{thinkingDots} {elapsedSeconds}s
            </Text>
          </Box>
        ) : null}
      </Box>

      {approvalRequest ? (
        <Box flexDirection="column" borderStyle="single" borderColor={activeTheme.warning} paddingX={1} marginY={1}>
          <Text bold color={activeTheme.warning}>Tool Approval Required</Text>
          <Text>The agent wants to run <Text bold color={activeTheme.primary}>{approvalRequest.name}</Text>:</Text>
          <Box marginLeft={2} marginY={0.5}>
            <Text color={activeTheme.muted}>{JSON.stringify(approvalRequest.input, null, 2)}</Text>
          </Box>
          <Text color={activeTheme.warning}>y approve | n deny | esc deny</Text>
        </Box>
      ) : null}

      {modelPicker.open ? (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor={activeTheme.accent}
          paddingX={1}
          paddingY={0.5}
          marginBottom={0.5}
          width="100%"
        >
          <Text bold color={activeTheme.accent}>
            Models for {PROVIDER_CATALOG[meta.provider].displayName}
          </Text>
          {modelPicker.items.length > 0 ? (
            modelPicker.items.map((model, idx) => (
              <Box key={model} flexDirection="row">
                <Text color={idx === selectedModelIndex ? activeTheme.accent : "gray"}>
                  {idx === selectedModelIndex ? "› " : "  "}
                </Text>
                <Text bold={model === meta.model} color={idx === selectedModelIndex ? activeTheme.accent : "white"}>
                  {model === meta.model ? "* " : "  "}
                  {model}
                </Text>
              </Box>
            ))
          ) : (
            <Text color={activeTheme.muted}>No matching model. Type /model {"<model-id>"}.</Text>
          )}
          <Box marginTop={0.5}>
            <Text color={activeTheme.muted}>
              up/down navigate | enter switch | type to filter
            </Text>
          </Box>
        </Box>
      ) : themePicker.open ? (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor={activeTheme.accent}
          paddingX={1}
          paddingY={0.5}
          marginBottom={0.5}
          width="100%"
        >
          <Text bold color={activeTheme.accent}>Themes</Text>
          {themePicker.items.length > 0 ? (
            themePicker.items.map((theme, idx) => (
              <Box key={theme.id} flexDirection="row">
                <Text color={idx === selectedThemeIndex ? activeTheme.accent : "gray"}>
                  {idx === selectedThemeIndex ? "› " : "  "}
                </Text>
                <Text bold={theme.id === activeTheme.id} color={idx === selectedThemeIndex ? activeTheme.accent : "white"}>
                  {theme.id === activeTheme.id ? "* " : "  "}
                  {theme.id.padEnd(10)} {theme.name}
                </Text>
              </Box>
            ))
          ) : (
            <Text color={activeTheme.muted}>No matching theme. Type /theme.</Text>
          )}
          <Box marginTop={0.5}>
            <Text color={activeTheme.muted}>
              up/down navigate | enter apply | type to filter
            </Text>
          </Box>
        </Box>
      ) : showSlashMenu && filteredCommands.length > 0 ? (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor={activeTheme.accent}
          paddingX={1}
          paddingY={0.5}
          marginBottom={0.5}
          width="100%"
        >
          <Text bold color={activeTheme.accent}>Commands</Text>
          {filteredCommands.map((cmd, idx) => (
            <Box key={cmd.name} flexDirection="row">
              <Text color={idx === selectedCommandIndex ? activeTheme.accent : "gray"}>
                {idx === selectedCommandIndex ? "› " : "  "}
              </Text>
              <Text bold color={idx === selectedCommandIndex ? activeTheme.accent : "white"}>
                {cmd.name.padEnd(10)}
              </Text>
              <Text color={activeTheme.muted}> {cmd.desc}</Text>
            </Box>
          ))}
          <Box marginTop={0.5}>
            <Text color={activeTheme.muted}>up/down navigate | tab/enter select</Text>
          </Box>
        </Box>
      ) : null}

      <Box
        flexDirection="row"
        borderStyle="single"
        borderColor={busy ? activeTheme.success : activeTheme.primary}
        paddingX={1}
        width="100%"
      >
        <Text bold color={busy ? activeTheme.success : activeTheme.primary}>› </Text>
        <TextInput value={input} onChange={setInput} onSubmit={submit} />
      </Box>

      <Box width="100%" paddingX={1} justifyContent="space-between" marginTop={0.5}>
        <Text color={approvalRequest ? activeTheme.warning : activeTheme.muted}>{status}</Text>
        <Text color={activeTheme.muted}>
          tokens {tokenUsage.input + tokenUsage.output} | in {tokenUsage.input} | out {tokenUsage.output}
          {" | "}
          ctx {formatContextFooter(contextStatus)}
        </Text>
      </Box>
    </Box>
  );
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
      return <LabeledBlock label="you" color={theme.primary} text={item.text} width={width} />;
    case "assistant":
      return <LabeledBlock label="lucky" color={theme.success} text={item.text} width={width} />;
    case "error":
      return <LabeledBlock label="error" color={theme.error} text={item.text} width={width} />;
    case "tool":
      const toolText =
        item.output === undefined
          ? `${item.name}(${item.input}) -> running`
          : `${item.name}(${item.input}) -> ${item.error ? "error: " : ""}${item.output}`;
      return (
        <LabeledBlock
          label="tool"
          color={item.error ? theme.error : theme.muted}
          text={toolText}
          width={width}
          indent={2}
        />
      );
    case "command":
      return (
        <LabeledBlock
          label="system"
          color={theme.accent}
          text={formatCommandRows(item.title, item.rows)}
          width={width}
        />
      );
  }
}

function LabeledBlock({
  label,
  color,
  text,
  width,
  indent = 0,
}: {
  label: string;
  color: string;
  text: string;
  width: number;
  indent?: number;
}): React.JSX.Element {
  const labelWidth = 9;
  const lines = wrapText(text, width);

  return (
    <Box flexDirection="column" marginLeft={indent}>
      {lines.map((line, index) => (
        <Box key={index} flexDirection="row">
          <Box width={labelWidth}>
            {index === 0 ? (
              <Text bold color={color}>{label}</Text>
            ) : (
              <Text> </Text>
            )}
          </Box>
          <Text color={color}>{line}</Text>
        </Box>
      ))}
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

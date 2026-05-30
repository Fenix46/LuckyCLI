import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import React, { useCallback, useState, useEffect, useRef } from "react";
import {
  type Agent,
  type AgentEvent,
  type TokenUsage,
  loadStoredConfig,
  saveStoredConfig,
} from "@luckycli/core";

interface AppMeta {
  provider: string;
  model: string;
}

/** A line in the scrollback transcript. */
type Item =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; name: string; input: string; output?: string; error?: boolean }
  | { kind: "error"; text: string };

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
  { name: "/setup", desc: "Switch model provider or change settings" },
  { name: "/config", desc: "Show active provider and model info" },
  { name: "/theme", desc: "Cycle between terminal UI color themes" },
  { name: "/exit", desc: "Exit the lucky agent session" },
];

export function App({
  agent,
  meta,
  approvalRequest,
  setApprovalRequest,
  onTriggerSetup,
}: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
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

  const cycleTheme = useCallback(() => {
    setActiveTheme((prev) => {
      const idx = THEMES.findIndex((t) => t.id === prev.id);
      const nextTheme = THEMES[(idx + 1) % THEMES.length] as Theme;
      try {
        const cfg = loadStoredConfig();
        cfg.theme = nextTheme.id;
        saveStoredConfig(cfg);
      } catch {
        // ignore
      }
      setItems((prevItems) => [
        ...prevItems,
        { kind: "assistant", text: `Theme changed to: ${nextTheme.name}` },
      ]);
      return nextTheme;
    });
  }, []);

  // Real-time metrics
  const [tokenUsage, setTokenUsage] = useState({ input: 0, output: 0 });

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

  // Slash commands navigation
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const showSlashMenu = input.startsWith("/");
  const filteredCommands = ALL_SLASH_COMMANDS.filter((cmd) =>
    cmd.name.startsWith(input)
  );

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

    // 2. Interactive Slash Commands menu navigation
    if (showSlashMenu && filteredCommands.length > 0) {
      if (key.downArrow) {
        setSelectedCommandIndex((prev) => (prev + 1) % filteredCommands.length);
        return;
      }
      if (key.upArrow) {
        setSelectedCommandIndex(
          (prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length
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

    // 3. Regular Ctrl+C exit
    if (key.ctrl && _in === "c" && busy) {
      abortControllerRef.current?.abort();
      return;
    }
    if (key.ctrl && _in === "c" && !busy) exit();
  });

  const submit = useCallback(
    async (value: string) => {
      const text = value.trim();
      if (!text || busy) return;

      if (text === "/exit" || text === "/quit") {
        exit();
        return;
      }
      if (text === "/theme") {
        cycleTheme();
        setInput("");
        return;
      }
      if (text === "/setup" || text === "/provider") {
        onTriggerSetup();
        setInput("");
        return;
      }
      if (text === "/help") {
        setItems((prev) => [
          ...prev,
          {
            kind: "assistant",
            text: "/help · /setup · /config · /theme · /exit",
          },
        ]);
        setInput("");
        return;
      }
      if (text === "/config") {
        setItems((prev) => [
          ...prev,
          { kind: "assistant", text: `${meta.provider} / ${meta.model}` },
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
            text: `unknown command: ${text} (try /help or /setup)`,
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
              setItems((prev) => [
                ...prev,
                { kind: "tool", name, input: preview(rawInput) },
              ]);
            },
            onToolEnd: (name, output, error) =>
              setItems((prev) => patchLastTool(prev, name, output, error)),
            onError: (message) =>
              setItems((prev) => [...prev, { kind: "error", text: message }]),
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
        if (assistantBuf) {
          setItems((prev) => [
            ...prev,
            { kind: "assistant", text: assistantBuf },
          ]);
        }
        setStreaming("");
        setBusy(false);
        setStartedAt(null);
      }
    },
    [agent, busy, meta, exit, cycleTheme, onTriggerSetup],
  );

  const transcriptHeight = Math.max(6, terminalSize.height - 10);
  const visibleItems = items.slice(-transcriptHeight);
  const hiddenItems = items.length - visibleItems.length;
  const status = approvalRequest ? "approval required" : busy ? `thinking ${elapsedSeconds}s` : "ready";

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
            <ItemView item={item} theme={activeTheme} />
          </Box>
        ))}
        {streaming ? (
          <Box marginY={0.5}>
            <ItemView item={{ kind: "assistant", text: streaming }} theme={activeTheme} />
          </Box>
        ) : busy && !approvalRequest ? (
          <Box marginY={0.5}>
            <Text color={activeTheme.muted}>assistant  thinking...</Text>
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

      {showSlashMenu && filteredCommands.length > 0 ? (
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
        <Text color={activeTheme.muted}>tokens {tokenUsage.input + tokenUsage.output} | in {tokenUsage.input} | out {tokenUsage.output}</Text>
      </Box>
    </Box>
  );
}

function ItemView({ item, theme }: { item: Item; theme: Theme }): React.JSX.Element {
  switch (item.kind) {
    case "user":
      return <LabeledLine label="you" color={theme.primary} text={item.text} />;
    case "assistant":
      return <LabeledLine label="lucky" color={theme.success} text={item.text} />;
    case "error":
      return <LabeledLine label="error" color={theme.error} text={item.text} />;
    case "tool":
      return (
        <Box flexDirection="column" marginLeft={2}>
          <Text color={theme.muted}>tool     {item.name}({item.input})</Text>
          {item.output !== undefined ? (
            <Text color={item.error ? theme.error : theme.muted}>result   {item.output}</Text>
          ) : null}
        </Box>
      );
  }
}

function LabeledLine({
  label,
  color,
  text,
}: {
  label: string;
  color: string;
  text: string;
}): React.JSX.Element {
  return (
    <Box flexDirection="row">
      <Box width={9}>
        <Text bold color={color}>{label}</Text>
      </Box>
      <Text color={color}>{text}</Text>
    </Box>
  );
}

interface EventHandlers {
  onText: (delta: string) => void;
  onToolStart: (name: string, rawInput: unknown) => void;
  onToolEnd: (name: string, output: string, error: boolean) => void;
  onError: (message: string) => void;
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

function preview(value: unknown, max = 120): string {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

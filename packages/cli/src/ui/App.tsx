import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import React, { useCallback, useState, useEffect } from "react";
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
}

interface Theme {
  id: string;
  name: string;
  primary: string;
  success: string;
  accent: string;
  warning: string;
}

const THEMES: Theme[] = [
  { id: "neon", name: "Neon Cyan (Default)", primary: "cyan", accent: "magenta", success: "green", warning: "yellow" },
  { id: "cyberpunk", name: "Cyberpunk", primary: "yellow", accent: "cyan", success: "green", warning: "red" },
  { id: "dracula", name: "Dracula Purple", primary: "magenta", accent: "red", success: "green", warning: "yellow" },
  { id: "matrix", name: "Hacker Matrix", primary: "green", accent: "green", success: "green", warning: "yellow" },
  { id: "minimal", name: "Minimal Monochrome", primary: "white", accent: "gray", success: "white", warning: "white" }
];

const WELCOME_LOGO = `
  _      _    _  ____ _  __ __   __ ____ _     ___ 
 | |    | |  | |/ ___| |/ / \\\\ / // ___| |   |_ _|
 | |    | |  | | |   | ' /   \\\\ V /| |   | |    | | 
 | |___ | |__| | |___| . \\\\    | | | |___| |___ | | 
 |_____| \\\\____/ \\\\____|_|\\\\_\\\\   |_|  \\\\____|_____|___|
`;

const ALL_SLASH_COMMANDS = [
  { name: "/help", desc: "Show all available slash commands" },
  { name: "/config", desc: "Show active provider and model info" },
  { name: "/theme", desc: "Cycle between terminal UI color themes" },
  { name: "/exit", desc: "Exit the lucky agent session" },
];

export function App({
  agent,
  meta,
  approvalRequest,
  setApprovalRequest,
}: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState("");

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
      if (text === "/help") {
        setItems((prev) => [
          ...prev,
          {
            kind: "assistant",
            text: "/help · /config · /theme · /exit — switch provider: relaunch with --setup",
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
            text: `unknown command: ${text} (try /help; to switch provider relaunch with --setup)`,
          },
        ]);
        setInput("");
        return;
      }

      setItems((prev) => [...prev, { kind: "user", text }]);
      setInput("");
      setBusy(true);

      let assistantBuf = "";
      const controller = new AbortController();
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
        if (assistantBuf) {
          setItems((prev) => [
            ...prev,
            { kind: "assistant", text: assistantBuf },
          ]);
        }
        setStreaming("");
        setBusy(false);
      }
    },
    [agent, busy, meta, exit, cycleTheme],
  );

  // Sliced to fit terminal viewport comfortably
  const visibleItems = items.slice(-8);

  return (
    <Box flexDirection="column" width={terminalSize.width} height={terminalSize.height} padding={1}>
      {/* Splash Welcome Logo */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={activeTheme.accent}>{WELCOME_LOGO}</Text>
        <Text color="gray">✦ Welcome to LuckyCLI! Type your message or enter / to browse commands.</Text>
      </Box>

      {/* Main clean scrollback stream */}
      <Box flexDirection="column" flexGrow={1} marginBottom={1}>
        {visibleItems.map((item, i) => (
          <Box key={i} marginY={0.5}>
            <ItemView item={item} theme={activeTheme} />
          </Box>
        ))}
        {streaming ? (
          <Box marginY={0.5}>
            <Text color={activeTheme.success}>lucky › {streaming}</Text>
          </Box>
        ) : null}
      </Box>

      {/* Tool safety approval dialog (shown inside the stream area) */}
      {approvalRequest ? (
        <Box flexDirection="column" borderStyle="single" borderColor={activeTheme.warning} paddingX={1} marginY={1}>
          <Text bold color={activeTheme.warning}>⚠️ TOOL APPROVAL REQUIRED</Text>
          <Text>The agent wants to run the side-effecting tool <Text bold color={activeTheme.primary}>{approvalRequest.name}</Text>:</Text>
          <Box marginLeft={2} marginY={0.5}>
            <Text color="gray">{JSON.stringify(approvalRequest.input, null, 2)}</Text>
          </Box>
          <Text bold color={activeTheme.warning}>Allow execution? (y: Yes / n: No / esc: Deny)</Text>
        </Box>
      ) : null}

      {/* Slash Commands Dropdown / Pop-up Menu */}
      {showSlashMenu && filteredCommands.length > 0 ? (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={activeTheme.accent}
          paddingX={1}
          paddingY={0.5}
          marginBottom={0.5}
          width="100%"
        >
          <Text bold color={activeTheme.accent}>⌨️ Slash Commands Menu</Text>
          {filteredCommands.map((cmd, idx) => (
            <Box key={cmd.name} flexDirection="row">
              <Text color={idx === selectedCommandIndex ? activeTheme.accent : "gray"}>
                {idx === selectedCommandIndex ? "› " : "  "}
              </Text>
              <Text bold color={idx === selectedCommandIndex ? activeTheme.accent : "white"}>
                {cmd.name.padEnd(10)}
              </Text>
              <Text color="gray"> - {cmd.desc}</Text>
            </Box>
          ))}
          <Box marginTop={0.5}>
            <Text dimColor>
              Navigate [Up/Down] · Select [Tab/Enter]
            </Text>
          </Box>
        </Box>
      ) : null}

      {/* Dedicated Writing Input Bar (No "you" prefix, just a clean styled arrow) */}
      <Box
        flexDirection="row"
        borderStyle="single"
        borderColor={busy ? activeTheme.success : activeTheme.primary}
        paddingX={1}
        width="100%"
      >
        <Text bold color={busy ? activeTheme.success : activeTheme.primary}>› </Text>
        {!busy ? (
          <TextInput value={input} onChange={setInput} onSubmit={submit} />
        ) : (
          !approvalRequest && <Text color="gray">… thinking</Text>
        )}
      </Box>

      {/* Bottom Status Bar with chosen config and real-time Token counters */}
      <Box width="100%" paddingX={1} justifyContent="space-between" marginTop={0.5}>
        <Text color="gray">🤖 Provider: {meta.provider} · 🧠 Model: {meta.model}</Text>
        <Text color={activeTheme.warning}>
          ⚡ Tokens: {tokenUsage.input + tokenUsage.output} (In: {tokenUsage.input} / Out: {tokenUsage.output})
        </Text>
      </Box>
    </Box>
  );
}

function ItemView({ item, theme }: { item: Item; theme: Theme }): React.JSX.Element {
  switch (item.kind) {
    case "user":
      return <Text color={theme.primary}>› {item.text}</Text>;
    case "assistant":
      return <Text color={theme.success}>lucky › {item.text}</Text>;
    case "error":
      return <Text color="red">error: {item.text}</Text>;
    case "tool":
      return (
        <Box flexDirection="column">
          <Text color="gray">⚙  {item.name}({item.input})</Text>
          {item.output !== undefined ? (
            <Text color={item.error ? "red" : "gray"}>   ↳ {item.output}</Text>
          ) : null}
        </Box>
      );
  }
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

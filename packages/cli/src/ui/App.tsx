import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import React, { useCallback, useState, useEffect } from "react";
import type { Agent, AgentEvent, TokenUsage } from "@luckycli/core";

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

  // Real-time session metrics
  const [editedFiles, setEditedFiles] = useState<string[]>([]);
  const [readFiles, setReadFiles] = useState<string[]>([]);
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

  // Ctrl+C exits when idle. Support y/n for tool approval when active.
  useInput((_in, key) => {
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
      if (text === "/help") {
        setItems((prev) => [
          ...prev,
          {
            kind: "assistant",
            text: "/help · /config · /exit — switch provider: relaunch with --setup",
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

              // Update statistics
              if (rawInput && typeof rawInput === "object") {
                const args = rawInput as Record<string, unknown>;
                if (typeof args.path === "string") {
                  const basename = args.path.split("/").pop() ?? args.path;
                  if (name === "write_file") {
                    setEditedFiles((prev) => Array.from(new Set([...prev, basename])));
                  } else if (name === "read_file") {
                    setReadFiles((prev) => Array.from(new Set([...prev, basename])));
                  }
                }
              }
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
    [agent, busy, meta, exit],
  );

  // Dynamic slice to fit screen comfortably
  const visibleItems = items.slice(-8);

  return (
    <Box flexDirection="column" width={terminalSize.width} height={terminalSize.height} padding={1}>
      {/* Header bar */}
      <Box width="100%" flexDirection="row" justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">✦ LUCKY AGENT ✦</Text>
        <Text color="gray">
          [ Provider: {meta.provider} | Model: {meta.model} ]
        </Text>
      </Box>

      {/* Chat scrollback container */}
      <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor="gray" paddingX={1} marginBottom={1}>
        <Box flexDirection="column" flexGrow={1}>
          {visibleItems.map((item, i) => (
            <Box key={i} marginY={0.5}>
              <ItemView item={item} />
            </Box>
          ))}
          {streaming ? (
            <Box marginY={0.5}>
              <Text color="green">lucky › {streaming}</Text>
            </Box>
          ) : null}
        </Box>
      </Box>

      {/* Dynamic Info bar */}
      <Box width="100%" justifyContent="space-between" paddingX={1} marginBottom={1}>
        <Box flexDirection="row">
          <Text bold color="cyan">📁 Files Read: </Text>
          <Text>{readFiles.length > 0 ? readFiles.slice(-3).join(", ") : "0"}</Text>
        </Box>
        <Box flexDirection="row">
          <Text bold color="green">📝 Edited: </Text>
          <Text>{editedFiles.length > 0 ? editedFiles.slice(-3).join(", ") : "0"}</Text>
        </Box>
        <Box flexDirection="row">
          <Text bold color="yellow">⚡ Tokens: </Text>
          <Text>{tokenUsage.input + tokenUsage.output}</Text>
        </Box>
      </Box>

      {/* Chat Form Box */}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={approvalRequest ? "yellow" : busy ? "green" : "cyan"}
        paddingX={1}
        width="100%"
      >
        {approvalRequest ? (
          <Box flexDirection="column" marginY={0.5}>
            <Text bold color="yellow">⚠️ TOOL APPROVAL REQUIRED</Text>
            <Text>The agent wants to execute the side-effecting tool <Text bold color="cyan">{approvalRequest.name}</Text>:</Text>
            <Box marginLeft={2} marginY={0.5}>
              <Text color="gray">{JSON.stringify(approvalRequest.input, null, 2)}</Text>
            </Box>
            <Text bold color="yellow">Allow execution? (y: Yes / n: No / esc: Deny)</Text>
          </Box>
        ) : (
          <Box flexDirection="row" marginY={0.5}>
            <Text bold color={busy ? "green" : "cyan"}>Prompt › </Text>
            {!busy ? (
              <TextInput value={input} onChange={setInput} onSubmit={submit} />
            ) : (
              <Text color="gray">… thinking</Text>
            )}
          </Box>
        )}

        <Box marginTop={0.5} marginBottom={0.5} justifyContent="space-between">
          <Text dimColor>[Enter] Send message</Text>
          <Text dimColor>│</Text>
          <Text dimColor>Commands: /help · /config · /exit</Text>
          <Text dimColor>│</Text>
          <Text dimColor>[Ctrl+C] Quit</Text>
        </Box>
      </Box>
    </Box>
  );
}

function ItemView({ item }: { item: Item }): React.JSX.Element {
  switch (item.kind) {
    case "user":
      return <Text color="cyan">you › {item.text}</Text>;
    case "assistant":
      return <Text color="green">lucky › {item.text}</Text>;
    case "error":
      return <Text color="red">error: {item.text}</Text>;
    case "tool":
      return (
        <Box flexDirection="column">
          <Text color="gray">
            ⚙ {item.name}({item.input})
          </Text>
          {item.output !== undefined ? (
            <Text color={item.error ? "red" : "gray"}>
              {"  ↳ "}
              {item.output}
            </Text>
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

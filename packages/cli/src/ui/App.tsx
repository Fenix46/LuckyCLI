import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import React, { useCallback, useState } from "react";
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
            },
            onToolEnd: (name, output, error) =>
              setItems((prev) => patchLastTool(prev, name, output, error)),
            onError: (message) =>
              setItems((prev) => [...prev, { kind: "error", text: message }]),
            onTurnEnd: () => {},
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

  return (
    <Box flexDirection="column" padding={1}>
      {/* Sleek Minimal Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">✦ lucky</Text>
        <Text color="gray"> · {meta.provider}/{meta.model} · /help /config /exit</Text>
      </Box>

      {/* Message scrollback */}
      <Box flexDirection="column">
        {items.map((item, i) => (
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

      {/* Tool Approval Request */}
      {approvalRequest ? (
        <Box flexDirection="column" marginY={1}>
          <Text bold color="yellow">⚠️  TOOL APPROVAL REQUIRED</Text>
          <Text color="gray">The agent wants to execute the side-effecting tool <Text bold color="cyan">{approvalRequest.name}</Text>:</Text>
          <Box marginLeft={2} marginY={0.5}>
            <Text color="gray">{JSON.stringify(approvalRequest.input, null, 2)}</Text>
          </Box>
          <Text bold color="yellow">Allow execution? (y: Yes / n: No / esc: Deny)</Text>
        </Box>
      ) : null}

      {/* Simple Prompt */}
      {!busy ? (
        <Box marginTop={1}>
          <Text color="cyan">you › </Text>
          <TextInput value={input} onChange={setInput} onSubmit={submit} />
        </Box>
      ) : (
        !approvalRequest && (
          <Box marginTop={1}>
            <Text color="gray">… thinking</Text>
          </Box>
        )
      )}
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

import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import React, { useCallback, useState } from "react";
import type { Agent, AgentEvent } from "@luckycli/core";

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

interface AppProps {
  agent: Agent;
  meta: AppMeta;
}

export function App({ agent, meta }: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState("");

  // Ctrl+C exits when idle.
  useInput((_in, key) => {
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
            onToolStart: (name, inputStr) =>
              setItems((prev) => [
                ...prev,
                { kind: "tool", name, input: inputStr },
              ]),
            onToolEnd: (name, output, error) =>
              setItems((prev) => patchLastTool(prev, name, output, error)),
            onError: (message) =>
              setItems((prev) => [...prev, { kind: "error", text: message }]),
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
    <Box flexDirection="column">
      <Text dimColor>
        ✦ lucky · {meta.provider}/{meta.model} · /help /config /exit
      </Text>
      {items.map((item, i) => (
        <ItemView key={i} item={item} />
      ))}
      {streaming ? (
        <Text color="green">lucky › {streaming}</Text>
      ) : null}
      {!busy ? (
        <Box>
          <Text color="cyan">you › </Text>
          <TextInput value={input} onChange={setInput} onSubmit={submit} />
        </Box>
      ) : (
        <Text color="gray">…thinking</Text>
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
  onToolStart: (name: string, input: string) => void;
  onToolEnd: (name: string, output: string, error: boolean) => void;
  onError: (message: string) => void;
}

function handleEvent(event: AgentEvent, h: EventHandlers): void {
  switch (event.type) {
    case "text":
      h.onText(event.delta);
      break;
    case "tool_start":
      h.onToolStart(event.name, preview(event.input));
      break;
    case "tool_end":
      h.onToolEnd(event.name, preview(event.content), event.isError);
      break;
    case "error":
      h.onError(event.message);
      break;
    case "turn_end":
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

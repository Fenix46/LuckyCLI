#!/usr/bin/env node
import "dotenv/config";
import { parseArgs } from "node:util";
import { render } from "ink";
import React from "react";
import { createMouseFilteredStdin } from "./mouse-input.js";
import {
  buildAndSaveGraph,
  latestSession,
  listSessions,
  loadSession,
  resolveConfig,
  type Session,
} from "@luckycli/core";
import { Root } from "./ui/Root.js";
import { runMcpCommand } from "./mcp-cli.js";
import { runUpdateCommand } from "./update-cli.js";
import { applyStagedUpdateIfAny } from "@luckycli/core";

const HELP = `lucky — a multi-provider terminal agent

Usage: lucky [options]

On first run, lucky asks you to pick a provider and enter its key, then
remembers your choice in ~/.luckycli/config.json. No .env required.

Options:
  -p, --provider  claude | openai | openai-oauth | gemini | antigravity | ollama
  -m, --model     model id (provider-specific)
  -c, --continue  resume the most recent session
      --resume [id]  resume a session; with no id, pick one interactively
      --sessions  list saved sessions and exit
      --setup     force the provider switcher
  -h, --help      show this help

Commands:
  graph build [path]    build the project knowledge graph into .lucky/graph
  graph rebuild [path]  rebuild it from scratch
  mcp list              list configured MCP servers
  mcp status            connect to each MCP server and report status
  mcp login <name>      authorize a remote MCP server via OAuth
  mcp logout <name>     forget a remote MCP server's stored tokens
  update                check for a newer release
  update --apply        download, verify, and install the latest release
  update --auto <mode>  set auto-update: off | notify | auto (default auto)
`;

function printSessions(): void {
  const sessions = listSessions();
  if (sessions.length === 0) {
    process.stdout.write("No saved sessions yet.\n");
    return;
  }
  for (const s of sessions) {
    const when = new Date(s.updatedAt).toISOString().replace("T", " ").slice(0, 16);
    const title = s.title ?? "(untitled)";
    process.stdout.write(
      `${s.id}  ${when}  ${s.provider}/${s.model}  ${s.messageCount} msgs  ${title}\n`,
    );
  }
}

/** `lucky graph build [path]` — build the project graph and exit (no TUI). */
async function runGraphCommand(args: string[]): Promise<void> {
  const [sub, target = "."] = args;
  if (sub !== "build" && sub !== "rebuild") {
    process.stderr.write(
      `Unknown graph command "${sub ?? ""}". Usage: lucky graph build|rebuild [path]\n`,
    );
    process.exit(1);
  }

  process.stdout.write(`Building graph for ${target} ...\n`);
  const summary = await buildAndSaveGraph(target, {
    onProgress: ({ file, index, total }) => {
      process.stdout.write(`  [${index}/${total}] ${file}\n`);
    },
  });

  process.stdout.write(
    `\nDone — ${summary.nodeCount} nodes, ${summary.edgeCount} edges ` +
      `from ${summary.fileCount} files.\n` +
      `Saved to ${summary.path}\n`,
  );
  if (summary.droppedEdges > 0) {
    process.stdout.write(`(${summary.droppedEdges} unresolved edges dropped)\n`);
  }
  for (const { file, reason } of summary.skipped) {
    process.stderr.write(`  skipped ${file}: ${reason}\n`);
  }
}

function main(): void {
  // Finish any update staged on a previous run before doing anything else, so a
  // cold start always lands on the newest binary. Best-effort: never blocks startup.
  const staged = applyStagedUpdateIfAny();
  if (staged.swapped) {
    process.stdout.write(`Updated to ${staged.version}. Running the new version.\n`);
  }

  // Subcommands are handled before the TUI path (they print and exit).
  const rawArgs = process.argv.slice(2);
  if (rawArgs[0] === "graph") {
    runGraphCommand(rawArgs.slice(1)).catch((err) => {
      process.stderr.write(`graph build failed: ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    });
    return;
  }

  if (rawArgs[0] === "mcp") {
    runMcpCommand(rawArgs.slice(1))
      .then((code) => {
        if (code !== 0) process.exit(code);
      })
      .catch((err) => {
        process.stderr.write(`mcp command failed: ${err instanceof Error ? err.message : err}\n`);
        process.exit(1);
      });
    return;
  }

  if (rawArgs[0] === "update" || rawArgs[0] === "upgrade") {
    runUpdateCommand(rawArgs.slice(1))
      .then((code) => {
        if (code !== 0) process.exit(code);
      })
      .catch((err) => {
        process.stderr.write(`update failed: ${err instanceof Error ? err.message : err}\n`);
        process.exit(1);
      });
    return;
  }

  const { values, positionals } = parseArgs({
    options: {
      provider: { type: "string", short: "p" },
      model: { type: "string", short: "m" },
      continue: { type: "boolean", short: "c" },
      resume: { type: "boolean" },
      sessions: { type: "boolean" },
      setup: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    process.stdout.write(HELP);
    return;
  }

  if (values.sessions) {
    printSessions();
    return;
  }

  // Resolve which session (if any) to resume, and whether to show the picker.
  let resume: Session | undefined;
  let pickResume = false;
  const resumeId = positionals[0];

  if (values.resume && resumeId) {
    const session = loadSession(resumeId);
    if (!session) {
      process.stderr.write(`No session found with id "${resumeId}".\n`);
      process.exit(1);
    }
    resume = session;
  } else if (values.resume) {
    // --resume with no id: pick interactively in the TUI.
    if (listSessions().length === 0) {
      process.stderr.write("No saved sessions to resume.\n");
      process.exit(1);
    }
    pickResume = true;
  } else if (values.continue) {
    const latest = latestSession();
    if (!latest) {
      process.stderr.write("No saved sessions to continue.\n");
      process.exit(1);
    }
    resume = loadSession(latest.id);
  }

  const config = resolveConfig({
    ...(values.provider ? { provider: values.provider } : {}),
    ...(values.model ? { model: values.model } : {}),
    // A resumed session pins its own provider/model unless overridden via flags.
    ...(!values.provider && resume ? { provider: resume.provider } : {}),
    ...(!values.model && resume ? { model: resume.model } : {}),
  });

  // Enable SGR mouse tracking so the wheel scrolls the transcript, and route
  // stdin through a filter that strips the mouse sequences before Ink sees them
  // (otherwise they leak into the prompt as raw "<64;..M" text). Only when
  // stdin is a real TTY; piped/non-interactive runs keep the plain stdin.
  const interactive = Boolean(process.stdin.isTTY);
  const mouse = interactive ? createMouseFilteredStdin(process.stdin) : null;
  if (interactive) {
    process.stdout.write("\x1b[?1000h\x1b[?1006h");
    const disableMouse = () => process.stdout.write("\x1b[?1006l\x1b[?1000l");
    process.on("exit", disableMouse);
    process.on("SIGINT", () => {
      disableMouse();
      process.exit(0);
    });
  }

  const instance = render(
    React.createElement(Root, {
      config,
      forceSetup: values.setup === true,
      ...(resume ? { resume } : {}),
      ...(pickResume ? { pickResume: true } : {}),
    }),
    // Render in the terminal's alternate screen (like vim/less): Ink owns the
    // whole screen and redraws in place, so the streaming reply renders at full
    // height with no scrollback duplication. The transcript scrolls internally.
    {
      alternateScreen: true,
      ...(mouse ? { stdin: mouse.stdin } : {}),
    },
  );

  instance.waitUntilExit().finally(() => {
    mouse?.dispose();
    if (interactive) process.stdout.write("\x1b[?1006l\x1b[?1000l");
  });
}

main();

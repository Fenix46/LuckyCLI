#!/usr/bin/env node
import "dotenv/config";
import { parseArgs } from "node:util";
import { render } from "ink";
import React from "react";
import {
  latestSession,
  listSessions,
  loadSession,
  resolveConfig,
  type Session,
} from "@luckycli/core";
import { Root } from "./ui/Root.js";

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

function main(): void {
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

  render(
    React.createElement(Root, {
      config,
      forceSetup: values.setup === true,
      ...(resume ? { resume } : {}),
      ...(pickResume ? { pickResume: true } : {}),
    }),
  );
}

main();

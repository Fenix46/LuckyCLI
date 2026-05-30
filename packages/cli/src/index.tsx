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
  -p, --provider  claude | openai | openai-oauth | gemini | ollama
  -m, --model     model id (provider-specific)
  -c, --continue  resume the most recent session
      --resume    resume a specific session by id
      --sessions  list saved sessions and exit
      --setup     force the provider setup dialog
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

function resolveResume(values: {
  continue?: boolean;
  resume?: string;
}): Session | undefined {
  if (values.resume) {
    const session = loadSession(values.resume);
    if (!session) {
      process.stderr.write(`No session found with id "${values.resume}".\n`);
      process.exit(1);
    }
    return session;
  }
  if (values.continue) {
    const latest = latestSession();
    if (!latest) {
      process.stderr.write("No saved sessions to continue.\n");
      process.exit(1);
    }
    return loadSession(latest.id);
  }
  return undefined;
}

function main(): void {
  const { values } = parseArgs({
    options: {
      provider: { type: "string", short: "p" },
      model: { type: "string", short: "m" },
      continue: { type: "boolean", short: "c" },
      resume: { type: "string" },
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

  const resume = resolveResume(values);

  const config = resolveConfig({
    ...(values.provider ? { provider: values.provider } : {}),
    // A resumed session pins its own provider/model unless overridden via flags.
    ...(values.model ? { model: values.model } : {}),
    ...(!values.provider && resume ? { provider: resume.provider } : {}),
    ...(!values.model && resume ? { model: resume.model } : {}),
  });

  render(
    React.createElement(Root, {
      config,
      forceSetup: values.setup === true,
      ...(resume ? { resume } : {}),
    }),
  );
}

main();

#!/usr/bin/env node
import "dotenv/config";
import { parseArgs } from "node:util";
import { render } from "ink";
import React from "react";
import {
  Agent,
  credentialsFromEnv,
  defaultToolRegistry,
  getProvider,
  loadConfig,
} from "@luckycli/core";
import { App } from "./ui/App.js";

const HELP = `lucky — a multi-provider terminal agent

Usage: lucky [options]

Options:
  -p, --provider  claude | openai | gemini | ollama
  -m, --model     model id (provider-specific)
  -h, --help      show this help

Configuration can also be set via .env (see .env.example).
`;

function main(): void {
  const { values } = parseArgs({
    options: {
      provider: { type: "string", short: "p" },
      model: { type: "string", short: "m" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    process.stdout.write(HELP);
    return;
  }

  const config = loadConfig({
    ...(values.provider ? { provider: values.provider } : {}),
    ...(values.model ? { model: values.model } : {}),
  });

  let provider;
  try {
    provider = getProvider(config.provider, credentialsFromEnv(config.provider));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`fatal: ${message}\n`);
    process.exit(1);
  }

  const agent = new Agent({
    provider,
    model: config.model,
    tools: defaultToolRegistry(),
    system: config.system,
    ...(config.temperature !== undefined
      ? { temperature: config.temperature }
      : {}),
    ...(config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}),
  });

  render(React.createElement(App, { agent, config }));
}

main();

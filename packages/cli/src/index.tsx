#!/usr/bin/env node
import "dotenv/config";
import { parseArgs } from "node:util";
import { render } from "ink";
import React from "react";
import { resolveConfig } from "@luckycli/core";
import { Root } from "./ui/Root.js";

const HELP = `lucky — a multi-provider terminal agent

Usage: lucky [options]

On first run, lucky asks you to pick a provider and enter its key, then
remembers your choice in ~/.luckycli/config.json. No .env required.

Options:
  -p, --provider  claude | openai | openai-oauth | gemini | ollama
  -m, --model     model id (provider-specific)
      --setup     force the provider setup dialog
  -h, --help      show this help
`;

function main(): void {
  const { values } = parseArgs({
    options: {
      provider: { type: "string", short: "p" },
      model: { type: "string", short: "m" },
      setup: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    process.stdout.write(HELP);
    return;
  }

  const config = resolveConfig({
    ...(values.provider ? { provider: values.provider } : {}),
    ...(values.model ? { model: values.model } : {}),
  });

  render(
    React.createElement(Root, { config, forceSetup: values.setup === true }),
  );
}

main();

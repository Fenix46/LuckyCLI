import { describe, expect, it, vi } from "vitest";
import type { MarkdownCommand } from "@luckycli/core";
import { buildMarkdownCommands } from "./markdown.js";
import type { CommandContext } from "./types.js";
import type { Item } from "../lib/items.js";

const source: MarkdownCommand = {
  name: "db:migrate",
  description: "Run a migration",
  argumentHint: "<name>",
  body: "Migrate the database to $1.",
  file: "/repo/.lucky/commands/db/migrate.md",
  scope: "project",
  origin: "lucky",
};

function harness(): {
  ctx: CommandContext;
  emitted: Item[];
  prompts: string[];
} {
  const emitted: Item[] = [];
  const prompts: string[] = [];
  const ctx = {
    emit: (...items: Item[]) => emitted.push(...items),
    ui: {
      runPrompt: vi.fn(async (text: string) => {
        prompts.push(text);
      }),
    },
  } as unknown as CommandContext;
  return { ctx, emitted, prompts };
}

describe("buildMarkdownCommands", () => {
  it("builds a slash command with the file description and hint", () => {
    const [command] = buildMarkdownCommands([source]);
    expect(command?.name).toBe("/db:migrate");
    expect(command?.description).toBe("Run a migration");
    expect(command?.category).toBe("command");
    expect(command?.hidden).toBeFalsy();
  });

  it("runs the expanded body as a prompt and notes the source", async () => {
    const [command] = buildMarkdownCommands([source]);
    const { ctx, emitted, prompts } = harness();
    await command!.run("users", ctx);
    expect(prompts).toEqual(["Migrate the database to users."]);
    expect(emitted[0]).toMatchObject({ kind: "command", title: "/db:migrate" });
  });

  it("falls back to a generated description", () => {
    const [command] = buildMarkdownCommands([{ ...source, description: "" }]);
    expect(command?.description).toBe("Run the /db:migrate command");
  });
});

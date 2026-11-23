/**
 * Turn discovered markdown commands into slash commands.
 *
 * The expansion and discovery live in core (`commands/markdown.ts`); this module
 * only adapts them to the CLI's `Command` surface. Running a command sends its
 * expanded body as an operative turn and leaves a compact note in the
 * transcript, mirroring how `/skill use` behaves.
 */
import { expandMarkdownCommand, type MarkdownCommand } from "@luckycli/core";
import type { Command } from "./types.js";

export function buildMarkdownCommands(commands: MarkdownCommand[]): Command[] {
  return commands.map((source) => ({
    name: `/${source.name}`,
    description: source.description || `Run the /${source.name} command`,
    category: "command",
    async run(args, ctx) {
      ctx.emit({
        kind: "command",
        title: `/${source.name}`,
        rows: [
          { label: "source", value: source.file },
          ...(source.argumentHint ? [{ label: "args", value: source.argumentHint }] : []),
        ],
      });
      await ctx.ui.runPrompt(expandMarkdownCommand(source, args));
    },
  }));
}

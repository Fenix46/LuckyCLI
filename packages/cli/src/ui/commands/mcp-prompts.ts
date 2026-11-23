/**
 * MCP prompts as slash commands, matching the `/mcp__<server>__<prompt>`
 * convention other clients use.
 *
 * The prompt's declared arguments are filled positionally (`/mcp__s__p one two`)
 * or by name (`/mcp__s__p topic=security`); the resolved prompt text is then
 * sent as an operative turn. Listing and fetching stay in core/the manager; this
 * module only shapes the commands and arguments.
 */
import { splitArguments, type McpPromptDescriptor } from "@luckycli/core";
import type { Command } from "./types.js";

export interface McpPromptCommand {
  server: string;
  prompt: McpPromptDescriptor;
}

/** Replace characters that cannot appear in a slash-command token. */
function slug(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_");
}

/** Claude-compatible slash name for one prompt. */
export function mcpPromptSlashName(server: string, prompt: string): string {
  return `/mcp__${slug(server)}__${slug(prompt)}`;
}

/**
 * Map command arguments onto the prompt's declared arguments. `name=value`
 * matches a declared name; anything else fills the next positional slot, in
 * declaration order. Unknown named tokens are treated positionally.
 */
export function parseMcpPromptArgs(
  spec: string,
  argumentsList: McpPromptDescriptor["arguments"] = [],
): Record<string, string> {
  const definitions = argumentsList ?? [];
  const result: Record<string, string> = {};
  const filled = new Set<string>();
  let position = 0;
  for (const token of splitArguments(spec)) {
    const equals = token.indexOf("=");
    const key = equals > 0 ? token.slice(0, equals) : "";
    if (key && definitions.some((definition) => definition.name === key)) {
      result[key] = token.slice(equals + 1);
      filled.add(key);
      continue;
    }
    while (position < definitions.length && filled.has(definitions[position]!.name)) position++;
    const definition = definitions[position];
    position++;
    if (definition) {
      result[definition.name] = token;
      filled.add(definition.name);
    }
  }
  return result;
}

export function buildMcpPromptCommands(entries: McpPromptCommand[]): Command[] {
  return entries.map(({ server, prompt }) => ({
    name: mcpPromptSlashName(server, prompt.name),
    description: prompt.description || `MCP prompt "${prompt.name}" from ${server}`,
    async run(args, ctx) {
      const parsed = parseMcpPromptArgs(args, prompt.arguments);
      ctx.emit({
        kind: "command",
        title: "MCP prompt",
        rows: [
          { label: "server", value: server },
          { label: "prompt", value: prompt.name },
        ],
      });
      const ok = await ctx.ui.runMcpPrompt(server, prompt.name, parsed);
      if (!ok) {
        ctx.emit({
          kind: "error",
          text: `MCP prompt "${prompt.name}" on "${server}" did not run.`,
        });
      }
    },
  }));
}

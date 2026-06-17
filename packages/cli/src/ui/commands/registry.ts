import { basicCommands } from "./basic.js";
import { unknownCommand } from "./helpers.js";
import { maintenanceCommands } from "./maintenance.js";
import { mcpCommands } from "./mcp.js";
import { providerCommands } from "./provider.js";
import { skillCommands } from "./skill.js";
import type { Command, CommandContext } from "./types.js";

// Presentation order of the visible commands in the slash menu and /help
// (the pre-registry menu order). Hidden and unlisted commands sort after,
// keeping their group order; dispatch is order-independent.
const MENU_ORDER = [
  "/model",
  "/thinking",
  "/mcp",
  "/skill",
  "/agents",
  "/status",
  "/update",
  "/compact",
  "/resume",
  "/provider",
  "/theme",
  "/graph",
  "/task",
  "/exit",
];

/**
 * Direct `/<skill-name>` commands for each installed+enabled skill, mirroring
 * how other agents invoke skills. Each dispatches to the same logic as
 * `/skill use <name>`. Names colliding with a built-in command are skipped so a
 * skill can never shadow core functionality.
 */
function skillAliasCommands(skillNames: string[], reserved: Set<string>): Command[] {
  return skillNames
    .map((name) => `/${name}`)
    .filter((slash) => !reserved.has(slash))
    .map((slash) => {
      const name = slash.slice(1);
      return {
        name: slash,
        description: `Run the ${name} skill`,
        hidden: true, // discoverable via /skill list; kept out of the core menu
        async run(_args, ctx) {
          const ok = await ctx.ui.runSkill(name);
          if (!ok) ctx.emit({ kind: "error", text: `skill "${name}" is unavailable — see /skill list` });
        },
      } satisfies Command;
    });
}

/**
 * The single source of truth for slash commands. The slash menu, /help and
 * dispatch all derive from this list; order here is menu order. Pass the names
 * of installed+enabled skills to expose them as direct `/<name>` commands.
 */
export function buildCommandRegistry(skillNames: string[] = []): Command[] {
  const base = [
    ...basicCommands(),
    ...providerCommands(),
    ...maintenanceCommands(),
    ...mcpCommands(),
    ...skillCommands(),
  ];
  const reserved = new Set(base.flatMap((c) => [c.name, ...(c.aliases ?? [])]));
  const commands = [...base, ...skillAliasCommands(skillNames, reserved)];
  const rank = (c: Command) => {
    const i = MENU_ORDER.indexOf(c.name);
    return i === -1 ? MENU_ORDER.length : i;
  };
  return commands.sort((a, b) => rank(a) - rank(b));
}

/** Visible commands shaped for the slash menu (and /help), in menu order. */
export function slashMenuEntries(registry: Command[]): { name: string; desc: string }[] {
  return registry
    .filter((command) => !command.hidden)
    .map((command) => ({ name: command.name, desc: command.description }));
}

function matchCommand(text: string, registry: Command[]): { command: Command; args: string } | null {
  for (const command of registry) {
    const names = [command.name, ...(command.aliases ?? [])];
    for (const name of names) {
      if (text === name) return { command, args: "" };
      if (text.startsWith(name + " ")) {
        return { command, args: text.slice(name.length).trim() };
      }
    }
  }
  return null;
}

/**
 * Run the command matching `text`, if any. Returns true when the input was
 * consumed: a command ran, or an unknown /x produced its error (unknown
 * slash commands never reach the model). Non-slash text returns false.
 */
export async function dispatchCommand(
  text: string,
  registry: Command[],
  ctx: CommandContext,
): Promise<boolean> {
  if (!text.startsWith("/")) return false;
  const match = matchCommand(text, registry);
  if (!match) {
    unknownCommand(ctx, text);
    return true;
  }
  await match.command.run(match.args, ctx);
  return true;
}

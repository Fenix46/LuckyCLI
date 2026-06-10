import { basicCommands } from "./basic.js";
import type { Command, CommandContext } from "./types.js";

/**
 * The single source of truth for slash commands. The slash menu, /help and
 * dispatch all derive from this list; order here is menu order.
 *
 * Remaining command groups land here as they migrate out of App.tsx's
 * submit() (APP_REFACTOR_PLAN.md tasks 3–4).
 */
export function buildCommandRegistry(): Command[] {
  return [...basicCommands()];
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
    ctx.emit({ kind: "error", text: `unknown command: ${text}. Try /help.` });
    return true;
  }
  await match.command.run(match.args, ctx);
  return true;
}

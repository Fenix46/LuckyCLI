import {
  loadStoredConfig,
  parseCommandRulesEnv,
  saveStoredConfig,
  type CommandRules,
} from "@luckycli/core";
import type { CommandRow } from "../lib/items.js";
import type { Command } from "./types.js";

/** Config access, injectable so tests never touch the real disk. */
export interface RulesCommandDeps {
  loadConfig: typeof loadStoredConfig;
  saveConfig: typeof saveStoredConfig;
  env: NodeJS.ProcessEnv;
}

const defaultDeps: RulesCommandDeps = {
  loadConfig: loadStoredConfig,
  saveConfig: saveStoredConfig,
  env: process.env,
};

const LISTS = ["allow", "ask", "deny"] as const;
type ListName = (typeof LISTS)[number];

const USAGE =
  "usage: /rules [allow|ask|deny <command pattern>] | /rules remove <pattern> — e.g. /rules deny git push --force*";

/**
 * /rules — view and edit the per-command rules for shell calls. `allow`
 * never asks, `ask` always asks (even in auto mode), `deny` never runs.
 * Patterns match a command and its longer forms by whole words ("git push"
 * covers "git push origin main"), or as globs when they contain `*`.
 */
export function rulesCommands(deps: RulesCommandDeps = defaultDeps): Command[] {
  return [
    {
      name: "/rules",
      description: "Allow, ask for or block specific shell commands",
      run(args, ctx) {
        const [verb, ...rest] = args.split(/\s+/).filter(Boolean);
        const pattern = rest.join(" ").trim();

        if (!verb) {
          ctx.emit({ kind: "command", title: "Command rules", rows: describeRules(deps) });
          return;
        }

        const cfg = deps.loadConfig();
        const rules: CommandRules = { ...(cfg.commandRules ?? {}) };

        if (verb === "remove" && pattern) {
          const had = LISTS.some((list) => rules[list]?.includes(pattern));
          for (const list of LISTS) {
            const kept = (rules[list] ?? []).filter((p) => p !== pattern);
            if (kept.length) rules[list] = kept;
            else delete rules[list];
          }
          if (!had) {
            ctx.emit({ kind: "error", text: `no saved rule for "${pattern}"` });
            return;
          }
          save(deps, cfg, rules);
          ctx.emit({ kind: "command", title: "Rule removed", rows: [{ label: "pattern", value: pattern }] });
          return;
        }

        if (isList(verb) && pattern) {
          // A pattern lives in one list at a time: re-adding it moves it.
          for (const list of LISTS) {
            const kept = (rules[list] ?? []).filter((p) => p !== pattern);
            if (kept.length) rules[list] = kept;
            else delete rules[list];
          }
          rules[verb] = [...(rules[verb] ?? []), pattern];
          save(deps, cfg, rules);
          ctx.emit({
            kind: "command",
            title: "Rule saved",
            rows: [
              { label: verb, value: pattern },
              { label: "effect", value: effectOf(verb) },
            ],
          });
          return;
        }

        ctx.emit({ kind: "error", text: USAGE });
      },
    },
  ];
}

function isList(value: string): value is ListName {
  return (LISTS as readonly string[]).includes(value);
}

function effectOf(list: ListName): string {
  if (list === "allow") return "runs without asking, in every mode";
  if (list === "ask") return "always asks first, even in auto mode";
  return "never runs";
}

function save(deps: RulesCommandDeps, cfg: ReturnType<typeof loadStoredConfig>, rules: CommandRules): void {
  const hasAny = LISTS.some((list) => rules[list]?.length);
  const next = { ...cfg };
  if (hasAny) next.commandRules = rules;
  else delete next.commandRules;
  deps.saveConfig(next);
}

function describeRules(deps: RulesCommandDeps): CommandRow[] {
  const stored = deps.loadConfig().commandRules ?? {};
  let fromEnv: CommandRules = {};
  let envError: string | undefined;
  try {
    fromEnv = parseCommandRulesEnv(deps.env.LUCKY_COMMAND_RULES);
  } catch (error) {
    envError = error instanceof Error ? error.message : String(error);
  }
  const rows: CommandRow[] = [];
  for (const list of LISTS) {
    for (const pattern of stored[list] ?? []) rows.push({ label: list, value: pattern });
    for (const pattern of fromEnv[list] ?? []) rows.push({ label: list, value: `${pattern}  (LUCKY_COMMAND_RULES)` });
  }
  if (rows.length === 0) rows.push({ label: "rules", value: "none — built-in checks only" });
  if (envError) rows.push({ label: "warning", value: envError });
  rows.push(
    { label: "built-in", value: "pushes, publishes, deploys, downloaded or inline scripts and destructive commands (also inside npm/make scripts) always ask" },
    { label: "edit", value: "/rules allow|ask|deny <pattern> · /rules remove <pattern>" },
  );
  return rows;
}

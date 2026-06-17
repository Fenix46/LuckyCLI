import {
  SkillCatalog,
  discoverSkills,
  installCatalogSkill,
  installSkillFromPath,
  seedStarterSkills,
  setSkillEnabled,
  uninstallSkill,
  type CatalogSkill,
  type DiscoveredSkill,
} from "@luckycli/core";
import { emitError, unknownCommand } from "./helpers.js";
import type { Command, CommandContext } from "./types.js";

/**
 * Catalog/store access, injectable so tests never hit network or disk. Mirrors
 * McpCommandDeps: the command logic (arg parsing, output shaping) is the unit
 * under test, not the filesystem or registry.
 */
export interface SkillCommandDeps {
  createCatalog(): Pick<SkillCatalog, "search" | "get" | "fetchBody">;
  discover: typeof discoverSkills;
  installFromPath: typeof installSkillFromPath;
  installFromCatalog: typeof installCatalogSkill;
  uninstall: typeof uninstallSkill;
  setEnabled: typeof setSkillEnabled;
  seedStarter: typeof seedStarterSkills;
}

const defaultDeps: SkillCommandDeps = {
  createCatalog: () => new SkillCatalog(),
  discover: discoverSkills,
  installFromPath: installSkillFromPath,
  installFromCatalog: installCatalogSkill,
  uninstall: uninstallSkill,
  setEnabled: setSkillEnabled,
  seedStarter: seedStarterSkills,
};

function skillRow(s: DiscoveredSkill): { label: string; value: string } {
  const state = s.enabled ? "enabled" : "disabled";
  const kws = s.keywords.length > 0 ? ` · ${s.keywords.join(", ")}` : "";
  return { label: s.name, value: `${state} — ${s.description}${kws}` };
}

async function listInstalled(ctx: CommandContext, deps: SkillCommandDeps): Promise<void> {
  const skills = await deps.discover();
  if (skills.length === 0) {
    ctx.emit({
      kind: "command",
      title: "Skills",
      rows: [{ label: "installed", value: "none — try /skill search <query> or /skill add <path>" }],
    });
    return;
  }
  ctx.emit({ kind: "command", title: "Installed skills", rows: skills.map(skillRow) });
}

async function searchCatalog(ctx: CommandContext, query: string, deps: SkillCommandDeps): Promise<void> {
  try {
    const results = await deps.createCatalog().search(query);
    if (results.length === 0) {
      ctx.emit({ kind: "command", title: "Skill search", rows: [{ label: "results", value: `no skills match "${query}"` }] });
      return;
    }
    ctx.emit({
      kind: "command",
      title: `Skill search: ${query || "(all)"}`,
      rows: results.map((s: CatalogSkill) => ({ label: s.name, value: s.description || "(no description)" })),
    });
  } catch (error) {
    emitError(ctx, error, "failed to search the skill catalog");
  }
}

export function skillCommands(deps: SkillCommandDeps = defaultDeps): Command[] {
  return [
    {
      name: "/skill",
      description: "Skills panel + run one on demand (use <name>, install, search, enable/disable)",
      aliases: ["/skills"],
      async run(args, ctx) {
        // First-run convenience: drop the starter pack in before doing anything,
        // so a brand-new user sees skills to try. Never clobbers edits; cheap and
        // idempotent after the first time. Best-effort — never block the command.
        const seeded = await deps.seedStarter().catch(() => [] as string[]);
        if (seeded.length > 0) {
          ctx.emit({
            kind: "command",
            title: "Starter skills installed",
            rows: seeded.map((name) => ({ label: name, value: "enabled" })),
          });
        }

        const [sub, ...rest] = args.split(/\s+/).filter(Boolean);
        const tail = rest.join(" ");

        if (!sub || sub === "list" || sub === "status") {
          // No subcommand opens the panel; explicit list/status print inline.
          if (!sub) {
            ctx.ui.openSkillPanel("installed");
            return;
          }
          await listInstalled(ctx, deps);
          return;
        }

        if (sub === "use" || sub === "run") {
          if (!tail) {
            ctx.emit({ kind: "error", text: `usage: /skill ${sub} <name>` });
            return;
          }
          const ok = await ctx.ui.runSkill(tail);
          if (!ok) {
            ctx.emit({
              kind: "error",
              text: `no enabled skill named "${tail}" — see /skill list`,
            });
          }
          return;
        }

        if (sub === "search") {
          // Bare `/skill search` opens the panel's search tab; with a query, print.
          if (!tail) {
            ctx.ui.openSkillPanel("search");
            return;
          }
          await searchCatalog(ctx, tail, deps);
          return;
        }

        if (sub === "add" || sub === "install") {
          if (!tail) {
            ctx.emit({ kind: "error", text: "usage: /skill add <name-in-catalog | local-path>" });
            return;
          }
          try {
            // A path-like argument installs from disk; otherwise treat it as a
            // catalog name.
            const looksLikePath = tail.includes("/") || tail.startsWith(".") || tail.startsWith("~");
            const res = looksLikePath
              ? await deps.installFromPath(tail)
              : await deps.installFromCatalog(tail);
            ctx.emit({
              kind: "command",
              title: "Skill installed",
              rows: [
                { label: "skill", value: res.name },
                { label: "source", value: looksLikePath ? "local path" : "catalog" },
              ],
            });
          } catch (error) {
            emitError(ctx, error, "failed to install the skill");
          }
          return;
        }

        if (sub === "enable" || sub === "disable") {
          if (!tail) {
            ctx.emit({ kind: "error", text: `usage: /skill ${sub} <name>` });
            return;
          }
          const ok = await deps.setEnabled(tail, sub === "enable");
          if (!ok) {
            ctx.emit({ kind: "error", text: `no installed skill named "${tail}"` });
            return;
          }
          ctx.emit({
            kind: "command",
            title: "Skill updated",
            rows: [
              { label: "skill", value: tail },
              { label: "enabled", value: sub === "enable" ? "true" : "false" },
            ],
          });
          return;
        }

        if (sub === "remove" || sub === "uninstall") {
          if (!tail) {
            ctx.emit({ kind: "error", text: "usage: /skill remove <name>" });
            return;
          }
          const ok = await deps.uninstall(tail);
          ctx.emit(
            ok
              ? { kind: "command", title: "Skill removed", rows: [{ label: "skill", value: tail }] }
              : { kind: "error", text: `no installed skill named "${tail}"` },
          );
          return;
        }

        unknownCommand(ctx, `/skill ${args}`);
      },
    },
  ];
}

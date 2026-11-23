/**
 * Headless `lucky skill` subcommands, mirroring `lucky mcp`: list, search,
 * add/install (local path, git source or catalog), import, remove, enable and
 * disable. They print and exit without the TUI, so skill setup works from
 * scripts and CI.
 *
 * The dependencies are injectable for the same reason as the MCP commands: the
 * argument parsing and output shaping are the unit under test, not the user's
 * home directory or the network.
 */

import {
  SkillCatalog,
  installCatalogSkill,
  installSkillFromSource,
  listAvailableSkills,
  setSkillEnabled,
  uninstallSkill,
  type AvailableSkill,
  type CatalogSkill,
  type InstallResult,
} from "@luckycli/core";

export interface SkillCommandIO {
  listAvailable?: typeof listAvailableSkills;
  installFromSource?: typeof installSkillFromSource;
  installFromCatalog?: typeof installCatalogSkill;
  createCatalog?: () => Pick<SkillCatalog, "search">;
  uninstall?: typeof uninstallSkill;
  setEnabled?: typeof setSkillEnabled;
  out?: (line: string) => void;
  err?: (line: string) => void;
}

const USAGE = `Usage:
  lucky skill list
  lucky skill search <query>
  lucky skill add <path | owner/repo | url> [--skill <name>] [--all] [--overwrite] [--ref <ref>] [--path <subdir>]
  lucky skill add <catalog-name> [--overwrite]
  lucky skill import <path | owner/repo | url> [--skill <name>] [--all] [--overwrite]
  lucky skill remove <name>
  lucky skill enable <name>
  lucky skill disable <name>`;

/** Table of installed skills, including the compatibility roots. */
export function skillListLines(skills: AvailableSkill[]): string[] {
  if (skills.length === 0) return ["No skills found."];
  const header = ["NAME", "SCOPE", "ORIGIN", "STATE", "DESCRIPTION"];
  const rows = skills.map((skill) => [
    skill.name,
    skill.scope,
    skill.origin,
    skill.enabled ? "enabled" : "disabled",
    skill.description,
  ]);
  const widths = header.map((label, index) =>
    Math.max(label.length, ...rows.map((row) => row[index]!.length)),
  );
  const render = (row: string[]) =>
    row
      .map((cell, index) =>
        index === row.length - 1 ? cell : cell.padEnd(widths[index]!),
      )
      .join("  ")
      .trimEnd();
  return [render(header), ...rows.map(render)];
}

function searchLines(results: CatalogSkill[]): string[] {
  if (results.length === 0) return ["No catalog skills match."];
  return results.map((skill) =>
    skill.description ? `${skill.name}  ${skill.description}` : skill.name,
  );
}

interface AddFlags {
  spec?: string;
  skill?: string;
  all?: boolean;
  overwrite?: boolean;
  ref?: string;
  subpath?: string;
  error?: string;
}

function takeValue(args: string[], index: number, flag: string): { value?: string; next: number; error?: string } {
  const inline = args[index]!;
  const equals = inline.indexOf("=");
  if (equals !== -1) return { value: inline.slice(equals + 1), next: index + 1 };
  const value = args[index + 1];
  if (!value) return { next: index + 1, error: `${flag} expects a value.` };
  return { value, next: index + 2 };
}

function parseAddFlags(args: string[]): AddFlags {
  const flags: AddFlags = {};
  const positional: string[] = [];
  let i = 0;
  while (i < args.length) {
    const token = args[i]!;
    if (token === "--all") {
      flags.all = true;
      i++;
      continue;
    }
    if (token === "--overwrite" || token === "-f") {
      flags.overwrite = true;
      i++;
      continue;
    }
    if (token === "--skill" || token.startsWith("--skill=")) {
      const parsed = takeValue(args, i, "--skill");
      if (parsed.error) return { ...flags, error: parsed.error };
      flags.skill = parsed.value;
      i = parsed.next;
      continue;
    }
    if (token === "--ref" || token.startsWith("--ref=")) {
      const parsed = takeValue(args, i, "--ref");
      if (parsed.error) return { ...flags, error: parsed.error };
      flags.ref = parsed.value;
      i = parsed.next;
      continue;
    }
    if (token === "--path" || token === "--subpath" || token.startsWith("--path=") || token.startsWith("--subpath=")) {
      const parsed = takeValue(args, i, "--path");
      if (parsed.error) return { ...flags, error: parsed.error };
      flags.subpath = parsed.value;
      i = parsed.next;
      continue;
    }
    if (token.startsWith("-")) return { ...flags, error: `Unknown option: ${token}` };
    positional.push(token);
    i++;
  }
  if (positional.length > 1) {
    return { ...flags, error: `Unexpected argument: ${positional.slice(1).join(" ")}` };
  }
  return { ...flags, spec: positional[0] };
}

/** A spec with a slash or a path marker is a source; a bare word is a catalog name. */
export function looksLikeSource(spec: string): boolean {
  return (
    spec.includes("/") ||
    spec.includes("\\") ||
    spec.startsWith(".") ||
    spec.startsWith("~") ||
    spec.includes("://") ||
    spec.startsWith("git@") ||
    spec.endsWith(".git")
  );
}

function reportInstalled(results: InstallResult[], out: (line: string) => void): void {
  for (const result of results) out(`Installed skill "${result.name}" in ${result.dir}`);
}

async function runAdd(
  args: string[],
  io: Required<Pick<SkillCommandIO, "out" | "err">> & SkillCommandIO,
  forceSource: boolean,
): Promise<number> {
  const flags = parseAddFlags(args);
  if (flags.error) {
    io.err(flags.error);
    return 1;
  }
  if (!flags.spec) {
    io.err(USAGE);
    return 1;
  }

  const source = forceSource || looksLikeSource(flags.spec);
  if (!source) {
    if (flags.skill || flags.all || flags.ref || flags.subpath) {
      io.err("--skill, --all, --ref and --path apply to path and git sources only.");
      return 1;
    }
    const result = await (io.installFromCatalog ?? installCatalogSkill)(flags.spec, {
      ...(flags.overwrite ? { overwrite: true } : {}),
    });
    reportInstalled([result], io.out);
    return 0;
  }

  const results = await (io.installFromSource ?? installSkillFromSource)(flags.spec, {
    ...(flags.skill ? { skill: flags.skill } : {}),
    ...(flags.all ? { all: true } : {}),
    ...(flags.overwrite ? { overwrite: true } : {}),
    ...(flags.ref ? { ref: flags.ref } : {}),
    ...(flags.subpath ? { subpath: flags.subpath } : {}),
  });
  reportInstalled(results, io.out);
  return 0;
}

/**
 * Run a `skill` subcommand. Returns a process exit code; errors are written to
 * `err` and never thrown, so the CLI wrapper only has to propagate the code.
 */
export async function runSkillCommand(args: string[], io: SkillCommandIO = {}): Promise<number> {
  const out = io.out ?? ((line) => process.stdout.write(`${line}\n`));
  const err = io.err ?? ((line) => process.stderr.write(`${line}\n`));
  const merged = { ...io, out, err };
  const sub = args[0] ?? "list";

  if (sub === "list") {
    const skills = (io.listAvailable ?? listAvailableSkills)();
    skillListLines(skills).forEach(out);
    return 0;
  }

  if (sub === "search") {
    const query = args.slice(1).join(" ").trim();
    if (!query) {
      err("Usage: lucky skill search <query>");
      return 1;
    }
    const catalog = (io.createCatalog ?? (() => new SkillCatalog()))();
    searchLines(await catalog.search(query)).forEach(out);
    return 0;
  }

  if (sub === "add" || sub === "install") {
    try {
      return await runAdd(args.slice(1), merged, false);
    } catch (error) {
      err(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }

  if (sub === "import") {
    if (!args[1]) {
      err("Usage: lucky skill import <path | owner/repo | url>");
      return 1;
    }
    try {
      return await runAdd(args.slice(1), merged, true);
    } catch (error) {
      err(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }

  if (sub === "remove" || sub === "uninstall") {
    const name = args[1];
    if (!name) {
      err("Usage: lucky skill remove <name>");
      return 1;
    }
    let removed: boolean;
    try {
      removed = await (io.uninstall ?? uninstallSkill)(name);
    } catch (error) {
      err(error instanceof Error ? error.message : String(error));
      return 1;
    }
    if (!removed) {
      err(`No skill named "${name}" installed in the lucky skills root.`);
      return 1;
    }
    out(`Removed skill "${name}".`);
    return 0;
  }

  if (sub === "enable" || sub === "disable") {
    const name = args[1];
    if (!name) {
      err(`Usage: lucky skill ${sub} <name>`);
      return 1;
    }
    const ok = await (io.setEnabled ?? setSkillEnabled)(name, sub === "enable");
    if (!ok) {
      err(`No skill named "${name}".`);
      return 1;
    }
    out(`Skill "${name}" ${sub === "enable" ? "enabled" : "disabled"}.`);
    return 0;
  }

  err(USAGE);
  return 1;
}

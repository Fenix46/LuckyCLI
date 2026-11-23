import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  globalSkillRoots,
  listAvailableSkills,
  projectSkillRoots,
  usableSkills,
} from "./available.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "lucky-skills-available-"));
  temps.push(dir);
  return dir;
}

function writeSkill(root: string, name: string, description = name): void {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\nbody\n`, "utf8");
}

function writeDisabled(skillRoot: string, names: string[]): void {
  const graph = join(skillRoot, "graph");
  mkdirSync(graph, { recursive: true });
  writeFileSync(join(graph, "disabled.json"), JSON.stringify(names), "utf8");
}

describe("skill roots", () => {
  it("orders project roots lucky, agents, claude", () => {
    expect(projectSkillRoots("/repo")).toEqual([
      "/repo/.lucky/skills",
      "/repo/.agents/skills",
      "/repo/.claude/skills",
    ]);
  });

  it("adds the compatibility roots only for the real global root", () => {
    const home = temp();
    const root = join(home, ".luckycli", "skills");
    expect(globalSkillRoots(root, home)).toEqual([
      root,
      join(home, ".agents", "skills"),
      join(home, ".claude", "skills"),
    ]);
    expect(globalSkillRoots(join(home, "other"), home)).toEqual([join(home, "other")]);
  });
});

describe("listAvailableSkills", () => {
  it("finds skills in every project root and reports their origin", () => {
    const cwd = temp();
    writeSkill(join(cwd, ".lucky", "skills"), "from-lucky");
    writeSkill(join(cwd, ".agents", "skills"), "from-agents");
    writeSkill(join(cwd, ".claude", "skills"), "from-claude");

    const skills = listAvailableSkills(cwd, join(cwd, "unused-global"), cwd);
    expect(skills.map((s) => [s.name, s.scope, s.origin])).toEqual([
      ["from-agents", "project", "agents"],
      ["from-claude", "project", "claude"],
      ["from-lucky", "project", "lucky"],
    ]);
  });

  it("shadows a compatibility skill with the lucky one of the same name", () => {
    const cwd = temp();
    writeSkill(join(cwd, ".lucky", "skills"), "review", "lucky review");
    writeSkill(join(cwd, ".agents", "skills"), "review", "agents review");
    writeSkill(join(cwd, ".claude", "skills"), "review", "claude review");

    const [skill] = listAvailableSkills(cwd, join(cwd, "unused-global"), cwd);
    expect(skill?.name).toBe("review");
    expect(skill?.description).toBe("lucky review");
    expect(skill?.origin).toBe("lucky");
  });

  it("lets a project skill win over a global skill of the same name", () => {
    const home = temp();
    const cwd = temp();
    const globalRoot = join(home, ".luckycli", "skills");
    writeSkill(globalRoot, "release", "global release");
    writeSkill(join(cwd, ".claude", "skills"), "release", "project release");

    const [skill] = listAvailableSkills(cwd, globalRoot, home);
    expect(skill?.description).toBe("project release");
    expect(skill?.scope).toBe("project");
  });

  it("reads the global compatibility roots under the real default root", () => {
    const home = temp();
    const cwd = temp();
    const globalRoot = join(home, ".luckycli", "skills");
    writeSkill(globalRoot, "own");
    writeSkill(join(home, ".agents", "skills"), "agents-global");
    writeSkill(join(home, ".claude", "skills"), "claude-global");

    const skills = listAvailableSkills(cwd, globalRoot, home);
    expect(skills.map((s) => [s.name, s.origin])).toEqual([
      ["agents-global", "agents"],
      ["claude-global", "claude"],
      ["own", "lucky"],
    ]);
  });

  it("does not read the home compatibility roots for an explicit temp root", () => {
    const home = temp();
    const cwd = temp();
    const root = join(home, "custom", "skills");
    writeSkill(root, "own");
    writeSkill(join(home, ".agents", "skills"), "agents-global");

    expect(listAvailableSkills(cwd, root, home).map((s) => s.name)).toEqual(["own"]);
  });

  it("follows symlinked skill directories", () => {
    const cwd = temp();
    const target = join(cwd, "shared", "linked");
    writeSkill(join(cwd, "shared"), "linked");
    const root = join(cwd, ".claude", "skills");
    mkdirSync(root, { recursive: true });
    symlinkSync(target, join(root, "linked"));

    expect(listAvailableSkills(cwd, join(cwd, "unused-global"), cwd).map((s) => s.name)).toEqual(["linked"]);
  });

  it("honors the global disabled set across every root", () => {
    const home = temp();
    const cwd = temp();
    const globalRoot = join(home, ".luckycli", "skills");
    writeSkill(join(home, ".agents", "skills"), "blocked");
    writeSkill(globalRoot, "allowed");
    writeDisabled(globalRoot, ["blocked"]);

    const skills = listAvailableSkills(cwd, globalRoot, home);
    expect(skills.find((s) => s.name === "blocked")?.enabled).toBe(false);
    expect(skills.find((s) => s.name === "allowed")?.enabled).toBe(true);
  });

  it("skips invalid skill files instead of failing the whole list", () => {
    const cwd = temp();
    const broken = join(cwd, ".claude", "skills", "broken");
    mkdirSync(broken, { recursive: true });
    writeFileSync(join(broken, "SKILL.md"), "no frontmatter", "utf8");
    writeSkill(join(cwd, ".claude", "skills"), "valid");

    expect(listAvailableSkills(cwd, join(cwd, "unused-global"), cwd).map((s) => s.name)).toEqual(["valid"]);
  });
});

describe("usableSkills", () => {
  it("filters disabled skills and a project allowlist", () => {
    const cwd = temp();
    writeSkill(join(cwd, ".lucky", "skills"), "a");
    writeSkill(join(cwd, ".lucky", "skills"), "b");
    writeDisabled(join(cwd, "unused-global"), []);
    expect(usableSkills(cwd, ["a"], join(cwd, "unused-global"), cwd).map((s) => s.name)).toEqual(["a"]);
  });
});

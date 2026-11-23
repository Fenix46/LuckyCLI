import { describe, expect, it, vi } from "vitest";
import { looksLikeSource, runSkillCommand, skillListLines, type SkillCommandIO } from "./skill-cli.js";
import type { AvailableSkill } from "@luckycli/core";

const skills: AvailableSkill[] = [
  {
    name: "release-flow",
    description: "cut a release",
    keywords: [],
    related: [],
    file: "/home/u/.luckycli/skills/release-flow/SKILL.md",
    dir: "/home/u/.luckycli/skills/release-flow",
    scope: "global",
    origin: "lucky",
    enabled: true,
  },
  {
    name: "rea",
    description: "reverse engineer anything",
    keywords: [],
    related: [],
    file: "/home/u/.agents/skills/reverse-engineer-anything/SKILL.md",
    dir: "/home/u/.agents/skills/reverse-engineer-anything",
    scope: "global",
    origin: "agents",
    enabled: false,
  },
];

const installed = [{ name: "release-flow", dir: "/home/u/.luckycli/skills/release-flow" }];

function fakeIO(overrides: Partial<SkillCommandIO> = {}): {
  io: SkillCommandIO;
  out: string[];
  err: string[];
} {
  const out: string[] = [];
  const err: string[] = [];
  const io: SkillCommandIO = {
    listAvailable: vi.fn(() => skills) as SkillCommandIO["listAvailable"],
    installFromSource: vi.fn(async () => installed) as SkillCommandIO["installFromSource"],
    installFromCatalog: vi.fn(async () => installed[0]!) as SkillCommandIO["installFromCatalog"],
    createCatalog: () => ({
      search: vi.fn(async () => [{ name: "docker", description: "build images", keywords: [], path: "docker/SKILL.md" }]),
    }),
    uninstall: vi.fn(async () => true) as SkillCommandIO["uninstall"],
    setEnabled: vi.fn(async () => true) as SkillCommandIO["setEnabled"],
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    ...overrides,
  };
  return { io, out, err };
}

describe("skillListLines", () => {
  it("includes scope, origin and state", () => {
    const lines = skillListLines(skills);
    expect(lines[0]).toContain("NAME");
    expect(lines[1]).toContain("release-flow");
    expect(lines[1]).toContain("lucky");
    expect(lines[1]).toContain("enabled");
    expect(lines[2]).toContain("agents");
    expect(lines[2]).toContain("disabled");
  });

  it("reports an empty list instead of printing a bare header", () => {
    expect(skillListLines([])).toEqual(["No skills found."]);
  });
});

describe("looksLikeSource", () => {
  it("separates catalog names from paths and repositories", () => {
    expect(looksLikeSource("docker-build")).toBe(false);
    expect(looksLikeSource("owner/repo")).toBe(true);
    expect(looksLikeSource("./skill")).toBe(true);
    expect(looksLikeSource("~/skill")).toBe(true);
    expect(looksLikeSource("https://github.com/a/b")).toBe(true);
    expect(looksLikeSource("git@github.com:a/b.git")).toBe(true);
  });
});

describe("runSkillCommand", () => {
  it("lists every available skill by default", async () => {
    const { io, out } = fakeIO();
    expect(await runSkillCommand([], io)).toBe(0);
    expect(out.join("\n")).toContain("release-flow");
    expect(out.join("\n")).toContain("reverse-engineer-anything".slice(0, 3));
  });

  it("searches the catalog", async () => {
    const { io, out } = fakeIO();
    expect(await runSkillCommand(["search", "docker"], io)).toBe(0);
    expect(out[0]).toContain("docker");
  });

  it("installs a local path through the git/local source installer", async () => {
    const { io } = fakeIO();
    expect(await runSkillCommand(["add", "./my-skill"], io)).toBe(0);
    expect(io.installFromSource).toHaveBeenCalledWith("./my-skill", {});
    expect(io.installFromCatalog).not.toHaveBeenCalled();
  });

  it("installs owner/repo with selection flags", async () => {
    const { io } = fakeIO();
    const code = await runSkillCommand(
      ["add", "owner/repo", "--skill", "two", "--ref", "main", "--path", "skills"],
      io,
    );
    expect(code).toBe(0);
    expect(io.installFromSource).toHaveBeenCalledWith("owner/repo", {
      skill: "two",
      ref: "main",
      subpath: "skills",
    });
  });

  it("installs a catalog name when the spec has no path markers", async () => {
    const { io } = fakeIO();
    expect(await runSkillCommand(["add", "docker-build"], io)).toBe(0);
    expect(io.installFromCatalog).toHaveBeenCalledWith("docker-build", {});
  });

  it("rejects source-only flags for a catalog name", async () => {
    const { io, err } = fakeIO();
    expect(await runSkillCommand(["add", "docker-build", "--all"], io)).toBe(1);
    expect(err[0]).toMatch(/path and git sources only/);
  });

  it("forces a source for import even for a bare name", async () => {
    const { io } = fakeIO();
    expect(await runSkillCommand(["import", "owner/repo"], io)).toBe(0);
    expect(io.installFromSource).toHaveBeenCalledWith("owner/repo", {});
    expect(io.installFromCatalog).not.toHaveBeenCalled();
  });

  it("surfaces installer errors and exits non-zero", async () => {
    const { io, err } = fakeIO({
      installFromSource: vi.fn(async () => {
        throw new Error("Found 2 skills in owner/repo");
      }) as SkillCommandIO["installFromSource"],
    });
    expect(await runSkillCommand(["add", "owner/repo"], io)).toBe(1);
    expect(err[0]).toMatch(/Found 2 skills/);
  });

  it("removes a skill and reports an unknown one", async () => {
    const removed = fakeIO();
    expect(await runSkillCommand(["remove", "release-flow"], removed.io)).toBe(0);
    expect(removed.out[0]).toContain("Removed");

    const missing = fakeIO({ uninstall: vi.fn(async () => false) as SkillCommandIO["uninstall"] });
    expect(await runSkillCommand(["remove", "ghost"], missing.io)).toBe(1);
    expect(missing.err[0]).toMatch(/lucky skills root/);
  });

  it("reports a skill installed outside the lucky root", async () => {
    const { io, err } = fakeIO({
      uninstall: vi.fn(async () => {
        throw new Error("Skill \"rea\" is installed in ~/.agents/skills/rea, outside lucky's skills root.");
      }) as SkillCommandIO["uninstall"],
    });
    expect(await runSkillCommand(["remove", "rea"], io)).toBe(1);
    expect(err[0]).toMatch(/outside lucky's skills root/);
  });

  it("enables and disables by name", async () => {
    const { io } = fakeIO();
    expect(await runSkillCommand(["enable", "release-flow"], io)).toBe(0);
    expect(io.setEnabled).toHaveBeenCalledWith("release-flow", true);
    expect(await runSkillCommand(["disable", "release-flow"], io)).toBe(0);
    expect(io.setEnabled).toHaveBeenCalledWith("release-flow", false);
  });

  it("prints usage for an unknown subcommand", async () => {
    const { io, err } = fakeIO();
    expect(await runSkillCommand(["wat"], io)).toBe(1);
    expect(err[0]).toContain("Usage:");
  });
});

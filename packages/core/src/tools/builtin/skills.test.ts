import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rebuildSkillGraph } from "../../skills/graph.js";
import { skillLoadTool, skillSearchTool } from "./skills.js";

// The tools resolve the skills root via skillsRootDir() == ~/.luckycli/skills,
// and os.homedir() honors $HOME / $USERPROFILE. Point those at a temp dir so the
// real home is never touched and the tools see our fixture skills.
const savedHome = process.env.HOME;
const savedUserProfile = process.env.USERPROFILE;
let home: string;
let root: string;

async function writeSkill(dir: string, body: string): Promise<void> {
  await mkdir(join(root, dir), { recursive: true });
  await writeFile(join(root, dir, "skill.md"), body, "utf8");
}

const RELEASE = `---
name: release-flow
description: cut a release of the project
keywords: [release, tag]
related: [npm-publish]
---
Bump, tag, push.`;

const PUBLISH = `---
name: npm-publish
description: publish a package to npm
keywords: [publish, npm]
---
npm publish body`;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "skills-home-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  root = join(home, ".luckycli", "skills");
});
afterEach(async () => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = savedUserProfile;
  await rm(home, { recursive: true, force: true });
});

const ctx = { cwd: process.cwd() };

describe("skill_search", () => {
  it("reports when no skills are installed", async () => {
    const res = await skillSearchTool.execute({ query: "anything" }, ctx);
    expect(res.content).toMatch(/No skills are installed/);
  });

  it("matches by keyword and never returns bodies", async () => {
    await writeSkill("release-flow", RELEASE);
    await writeSkill("npm-publish", PUBLISH);
    await rebuildSkillGraph(root);
    const res = await skillSearchTool.execute({ query: "release" }, ctx);
    expect(res.content).toContain("release-flow");
    expect(res.content).toContain("keywords:");
    expect(res.content).not.toContain("Bump, tag, push");
  });

  it("ranks more relevant skills first", async () => {
    await writeSkill("release-flow", RELEASE);
    await writeSkill("npm-publish", PUBLISH);
    await rebuildSkillGraph(root);
    const res = await skillSearchTool.execute({ query: "npm publish" }, ctx);
    const lines = res.content.split("\n").filter((l) => l.startsWith("-"));
    expect(lines[0]).toContain("npm-publish");
  });

  it("returns a no-match message", async () => {
    await writeSkill("release-flow", RELEASE);
    await rebuildSkillGraph(root);
    const res = await skillSearchTool.execute({ query: "kubernetes" }, ctx);
    expect(res.content).toMatch(/No skills match/);
  });
});

describe("skill_load", () => {
  it("returns the body and lists related skills", async () => {
    await writeSkill("release-flow", RELEASE);
    await writeSkill("npm-publish", PUBLISH);
    await rebuildSkillGraph(root);
    const res = await skillLoadTool.execute({ name: "release-flow" }, ctx);
    expect(res.content).toContain('<skill name="release-flow">');
    expect(res.content).toContain("Bump, tag, push.");
    expect(res.content).toContain("Related skills available (use skill_load): npm-publish");
  });

  it("errors model-side on an unknown skill", async () => {
    await writeSkill("release-flow", RELEASE);
    await rebuildSkillGraph(root);
    const res = await skillLoadTool.execute({ name: "does-not-exist" }, ctx);
    expect(res.content).toMatch(/No skill named/);
  });

  it("calls onSkillLoaded with the skill id", async () => {
    await writeSkill("release-flow", RELEASE);
    await rebuildSkillGraph(root);
    const onSkillLoaded = vi.fn();
    await skillLoadTool.execute({ name: "Release-Flow" }, { ...ctx, onSkillLoaded });
    expect(onSkillLoaded).toHaveBeenCalledWith("release-flow");
  });
});

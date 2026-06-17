import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SkillActivator } from "./activator.js";
import { rebuildSkillGraph } from "./graph.js";
import { setSkillEnabled } from "./install.js";

let root: string;
async function writeSkill(dir: string, body: string): Promise<void> {
  await mkdir(join(root, dir), { recursive: true });
  await writeFile(join(root, dir, "skill.md"), body, "utf8");
}

const RELEASE = `---
name: release-flow
description: cut a release
keywords: [release]
related: [npm-publish]
---
release body`;

const PUBLISH = `---
name: npm-publish
description: publish to npm
keywords: [publish]
---
publish body`;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "skills-act-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("SkillActivator.activate", () => {
  it("returns null when no graph exists", async () => {
    const act = new SkillActivator(root);
    expect(await act.activate("release-flow")).toBeNull();
  });

  it("loads a named skill's block and tracks it active", async () => {
    await writeSkill("release-flow", RELEASE);
    await writeSkill("npm-publish", PUBLISH);
    await rebuildSkillGraph(root);
    const act = new SkillActivator(root);

    const block = await act.activate("release-flow");
    expect(block).toContain('<skill name="release-flow">');
    expect(block).toContain("release body");
    // related neighbors still surface for discovery.
    expect(block).toContain("npm-publish");
    expect(act.activeSkills()).toEqual(["release-flow"]);
  });

  it("normalizes the requested name (case-insensitive)", async () => {
    await writeSkill("release-flow", RELEASE);
    await rebuildSkillGraph(root);
    const act = new SkillActivator(root);
    expect(await act.activate("Release-Flow")).toContain('<skill name="release-flow">');
  });

  it("returns null for an unknown skill", async () => {
    await writeSkill("release-flow", RELEASE);
    await rebuildSkillGraph(root);
    const act = new SkillActivator(root);
    expect(await act.activate("nope")).toBeNull();
    expect(act.activeSkills()).toEqual([]);
  });

  it("returns null for a disabled skill", async () => {
    await writeSkill("release-flow", RELEASE);
    await rebuildSkillGraph(root);
    await setSkillEnabled("release-flow", false, root);
    await rebuildSkillGraph(root);
    const act = new SkillActivator(root);
    expect(await act.activate("release-flow")).toBeNull();
  });

  it("clears the active set on compaction", async () => {
    await writeSkill("release-flow", RELEASE);
    await rebuildSkillGraph(root);
    const act = new SkillActivator(root);
    await act.activate("release-flow");
    act.onCompacted();
    expect(act.activeSkills()).toEqual([]);
  });
});

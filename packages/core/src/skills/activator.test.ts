import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SkillActivator } from "./activator.js";
import { rebuildSkillGraph } from "./graph.js";

let root: string;
async function writeSkill(dir: string, body: string): Promise<void> {
  await mkdir(join(root, dir), { recursive: true });
  await writeFile(join(root, dir, "skill.md"), body, "utf8");
}

const RELEASE = `---
name: release-flow
description: cut a release
keywords: [release]
---
release body`;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "skills-act-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("SkillActivator", () => {
  it("returns the message unchanged when no graph exists", async () => {
    const act = new SkillActivator(root);
    expect(await act.augment("release now")).toBe("release now");
  });

  it("appends the skill block on a match and tracks the active set", async () => {
    await writeSkill("release-flow", RELEASE);
    await rebuildSkillGraph(root);
    const act = new SkillActivator(root);
    const out = await act.augment("time to release");
    expect(out).toContain("time to release");
    expect(out).toContain('<skill name="release-flow">');
    expect(out).toContain("release body");
    expect(act.activeSkills()).toEqual(["release-flow"]);
  });

  it("does not re-inject an already-active skill", async () => {
    await writeSkill("release-flow", RELEASE);
    await rebuildSkillGraph(root);
    const act = new SkillActivator(root);
    await act.augment("release");
    const second = await act.augment("release again");
    expect(second).toBe("release again");
  });

  it("clears the active set on compaction", async () => {
    await writeSkill("release-flow", RELEASE);
    await rebuildSkillGraph(root);
    const act = new SkillActivator(root);
    await act.augment("release");
    act.onCompacted();
    expect(act.activeSkills()).toEqual([]);
    const out = await act.augment("release once more");
    expect(out).toContain('<skill name="release-flow">');
  });

  it("returns unchanged when nothing matches", async () => {
    await writeSkill("release-flow", RELEASE);
    await rebuildSkillGraph(root);
    const act = new SkillActivator(root);
    expect(await act.augment("unrelated text")).toBe("unrelated text");
  });
});

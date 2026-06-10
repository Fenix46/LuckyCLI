import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildSkillGraph,
  discoverSkills,
  loadSkillGraph,
  rebuildSkillGraph,
  saveDisabledSet,
  tryLoadSkillGraph,
} from "./graph.js";

let root: string;

async function writeSkill(dir: string, body: string): Promise<void> {
  await mkdir(join(root, dir), { recursive: true });
  await writeFile(join(root, dir, "skill.md"), body, "utf8");
}

const RELEASE = `---
name: release-flow
description: cut a release
keywords: [release, tag]
related: [npm-publish, missing-skill]
---
release body`;

const PUBLISH = `---
name: npm-publish
description: publish to npm
keywords: [publish, npm]
---
publish body`;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "skills-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("discoverSkills", () => {
  it("returns [] when the root does not exist", async () => {
    expect(await discoverSkills(join(root, "nope"))).toEqual([]);
  });

  it("parses every skill.md and sorts by directory", async () => {
    await writeSkill("release-flow", RELEASE);
    await writeSkill("npm-publish", PUBLISH);
    const skills = await discoverSkills(root);
    expect(skills.map((s) => s.name)).toEqual(["npm-publish", "release-flow"]);
    expect(skills.every((s) => s.enabled)).toBe(true);
  });

  it("throws on a duplicate skill name", async () => {
    await writeSkill("a", RELEASE);
    await writeSkill("b", RELEASE);
    await expect(discoverSkills(root)).rejects.toThrow(/Duplicate skill name/);
  });

  it("marks disabled skills via disabled.json", async () => {
    await writeSkill("release-flow", RELEASE);
    await saveDisabledSet(new Set(["release-flow"]), root);
    const [skill] = await discoverSkills(root);
    expect(skill?.enabled).toBe(false);
  });
});

describe("buildSkillGraph", () => {
  it("builds skill + keyword nodes and triggers edges", async () => {
    await writeSkill("release-flow", RELEASE);
    await writeSkill("npm-publish", PUBLISH);
    const graph = buildSkillGraph(await discoverSkills(root), root);

    const skillNodes = graph.nodes.filter((n) => n.kind === "skill");
    expect(skillNodes.map((n) => n.id).sort()).toEqual(["npm-publish", "release-flow"]);

    const triggers = graph.edges.filter((e) => e.relation === "triggers");
    // release: release, tag ; publish: publish, npm = 4
    expect(triggers).toHaveLength(4);
    expect(graph.meta.skillCount).toBe(2);
  });

  it("tolerates dangling related and creates resolvable related_to edges", async () => {
    await writeSkill("release-flow", RELEASE);
    await writeSkill("npm-publish", PUBLISH);
    const graph = buildSkillGraph(await discoverSkills(root), root);
    const related = graph.edges.filter((e) => e.relation === "related_to");
    expect(related).toEqual([
      { source: "release-flow", target: "npm-publish", relation: "related_to" },
    ]);
  });

  it("excludes disabled skills from the trigger index", async () => {
    await writeSkill("release-flow", RELEASE);
    await saveDisabledSet(new Set(["release-flow"]), root);
    const graph = buildSkillGraph(await discoverSkills(root), root);
    expect(graph.edges.filter((e) => e.relation === "triggers")).toHaveLength(0);
    // still has the skill node so the menu can re-enable it
    expect(graph.nodes.find((n) => n.id === "release-flow")?.attrs?.enabled).toBe(false);
  });
});

describe("persistence", () => {
  it("rebuild → load round-trips", async () => {
    await writeSkill("npm-publish", PUBLISH);
    const built = await rebuildSkillGraph(root);
    const loaded = await loadSkillGraph(root);
    expect(loaded).toEqual(built);
  });

  it("tryLoad returns null when absent", async () => {
    expect(await tryLoadSkillGraph(root)).toBeNull();
  });
});

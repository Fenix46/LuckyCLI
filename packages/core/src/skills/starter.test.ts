import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverSkills } from "./graph.js";
import { parseSkillFile } from "./skill-file.js";
import { STARTER_SKILLS, seedStarterSkills } from "./starter.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "skills-seed-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("STARTER_SKILLS", () => {
  it("each entry's content is a valid skill.md whose name matches", () => {
    for (const skill of STARTER_SKILLS) {
      const parsed = parseSkillFile(skill.content);
      expect(parsed.frontmatter.name).toBe(skill.name);
    }
  });
});

describe("seedStarterSkills", () => {
  it("writes every starter skill on first run and builds the graph", async () => {
    const written = await seedStarterSkills(root);
    expect(written.sort()).toEqual(STARTER_SKILLS.map((s) => s.name).sort());
    const installed = await discoverSkills(root);
    expect(installed).toHaveLength(STARTER_SKILLS.length);
  });

  it("is a no-op on the second run (idempotent)", async () => {
    await seedStarterSkills(root);
    expect(await seedStarterSkills(root)).toEqual([]);
  });

  it("never clobbers an existing/edited skill", async () => {
    const name = STARTER_SKILLS[0]!.name;
    await mkdir(join(root, name), { recursive: true });
    const edited = `---\nname: ${name}\ndescription: my edit\nkeywords: [mine]\n---\nedited body`;
    await writeFile(join(root, name, "skill.md"), edited, "utf8");

    const written = await seedStarterSkills(root);
    expect(written).not.toContain(name);
    const onDisk = await readFile(join(root, name, "skill.md"), "utf8");
    expect(onDisk).toBe(edited);
  });
});

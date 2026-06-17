import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSkillGraph, discoverSkills } from "./graph.js";
import {
  ACTIVATION_BUDGET,
  SKILL_NAVIGATION_REMINDER,
  matchSkills,
  renderSkillInjection,
} from "./matcher.js";

let root: string;
async function writeSkill(dir: string, body: string): Promise<void> {
  await mkdir(join(root, dir), { recursive: true });
  await writeFile(join(root, dir, "skill.md"), body, "utf8");
}

async function graphFrom(): Promise<Awaited<ReturnType<typeof buildSkillGraph>>> {
  return buildSkillGraph(await discoverSkills(root), root);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "skills-match-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const RELEASE = `---
name: release-flow
description: cut a release
keywords: [release, version bump]
related: [npm-publish]
---
release body`;

const PUBLISH = `---
name: npm-publish
description: publish to npm
keywords: [publish, npm]
---
publish body`;

const TESTING = `---
name: testing
description: write tests
keywords: [test, vitest, release]
---
testing body`;

describe("matchSkills", () => {
  it("returns nothing for a non-matching message", async () => {
    await writeSkill("release-flow", RELEASE);
    expect(matchSkills("hello world", await graphFrom())).toEqual([]);
  });

  it("matches a single-word keyword as a whole word", async () => {
    await writeSkill("release-flow", RELEASE);
    const m = matchSkills("time to release this", await graphFrom());
    expect(m.map((a) => a.id)).toEqual(["release-flow"]);
    expect(m[0]?.matched).toEqual(["release"]);
  });

  it("does not match a keyword inside a larger word", async () => {
    await writeSkill("release-flow", RELEASE);
    expect(matchSkills("prerelease notes", await graphFrom())).toEqual([]);
  });

  it("matches a multi-word phrase as a substring", async () => {
    await writeSkill("release-flow", RELEASE);
    const m = matchSkills("do a version bump please", await graphFrom());
    expect(m[0]?.matched).toContain("version bump");
  });

  it("scores by distinct keyword count and ranks higher first", async () => {
    await writeSkill("release-flow", RELEASE);
    await writeSkill("testing", TESTING);
    // "release" hits both; "version bump" hits only release-flow.
    // No "test"/"vitest" word, so release-flow scores 2 vs testing's 1.
    const m = matchSkills("release with a version bump", await graphFrom());
    expect(m[0]?.id).toBe("release-flow");
    expect(m[0]?.matched.length).toBeGreaterThan(m[1]?.matched.length ?? 0);
  });

  it("enforces the top-2 budget", async () => {
    await writeSkill("release-flow", RELEASE);
    await writeSkill("npm-publish", PUBLISH);
    await writeSkill("testing", TESTING);
    const m = matchSkills("release publish test", await graphFrom());
    expect(m).toHaveLength(ACTIVATION_BUDGET);
  });

  it("skips skills in the active set", async () => {
    await writeSkill("release-flow", RELEASE);
    const m = matchSkills("release", await graphFrom(), new Set(["release-flow"]));
    expect(m).toEqual([]);
  });

  it("populates related neighbors", async () => {
    await writeSkill("release-flow", RELEASE);
    await writeSkill("npm-publish", PUBLISH);
    const m = matchSkills("release", await graphFrom());
    expect(m[0]?.related).toEqual(["npm-publish"]);
  });
});

describe("renderSkillInjection", () => {
  it("wraps the body and lists related skills", async () => {
    await writeSkill("release-flow", RELEASE);
    await writeSkill("npm-publish", PUBLISH);
    const [act] = matchSkills("release", await graphFrom());
    const block = await renderSkillInjection(act!, root);
    expect(block).toBe(
      [
        '<skill name="release-flow">',
        "release body",
        "",
        "Related skills available (use skill_load): npm-publish",
        "",
        SKILL_NAVIGATION_REMINDER,
        "</skill>",
      ].join("\n"),
    );
  });

  it("appends the navigation reminder even with no related skills", async () => {
    await writeSkill("release-flow", RELEASE.replace("related: [npm-publish]\n", ""));
    const [act] = matchSkills("release", await graphFrom());
    const block = await renderSkillInjection(act!, root);
    expect(block).toBe(
      [
        '<skill name="release-flow">',
        "release body",
        "",
        SKILL_NAVIGATION_REMINDER,
        "</skill>",
      ].join("\n"),
    );
  });

  it("returns null when the body file is missing", async () => {
    await writeSkill("release-flow", RELEASE);
    const [act] = matchSkills("release", await graphFrom());
    const block = await renderSkillInjection({ ...act!, bodyPath: "nope/skill.md" }, root);
    expect(block).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { normalizeSkillName, parseSkillFile } from "./skill-file.js";

const VALID = `---
name: Release-Flow
description: How to cut a release of this kind of project
keywords: [release, version bump, changelog]
related: [conventional-commits, npm-publish]
---

Step 1. Bump the version.
Step 2. Tag and push.
`;

describe("normalizeSkillName", () => {
  it("trims, lowercases, and collapses whitespace", () => {
    expect(normalizeSkillName("  Version   Bump ")).toBe("version bump");
  });
});

describe("parseSkillFile", () => {
  it("parses valid frontmatter and extracts the body", () => {
    const skill = parseSkillFile(VALID);
    expect(skill.frontmatter.name).toBe("release-flow");
    expect(skill.frontmatter.description).toBe(
      "How to cut a release of this kind of project",
    );
    expect(skill.frontmatter.keywords).toEqual(["release", "version bump", "changelog"]);
    expect(skill.frontmatter.related).toEqual(["conventional-commits", "npm-publish"]);
    expect(skill.body).toBe("Step 1. Bump the version.\nStep 2. Tag and push.");
  });

  it("normalizes the name (case-insensitive)", () => {
    const skill = parseSkillFile(VALID);
    expect(skill.frontmatter.name).toBe("release-flow");
  });

  it("supports block-list keywords", () => {
    const src = `---
name: x
description: d
keywords:
  - alpha
  - Beta Two
---
body`;
    const skill = parseSkillFile(src);
    expect(skill.frontmatter.keywords).toEqual(["alpha", "beta two"]);
  });

  it("defaults related to an empty array", () => {
    const src = `---
name: x
description: d
keywords: [k]
---
b`;
    expect(parseSkillFile(src).frontmatter.related).toEqual([]);
  });

  it("dedupes keywords and related", () => {
    const src = `---
name: x
description: d
keywords: [k, k, K]
related: [a, a]
---
b`;
    const fm = parseSkillFile(src).frontmatter;
    expect(fm.keywords).toEqual(["k"]);
    expect(fm.related).toEqual(["a"]);
  });

  it("rejects a missing opening delimiter", () => {
    expect(() => parseSkillFile("name: x\n")).toThrow(/start with a '---'/);
  });

  it("rejects a missing closing delimiter", () => {
    expect(() => parseSkillFile("---\nname: x\n")).toThrow(/closing '---'/);
  });

  it("rejects empty keywords", () => {
    const src = `---
name: x
description: d
keywords: []
---
b`;
    expect(() => parseSkillFile(src)).toThrow(ZodError);
  });

  it("rejects an empty name", () => {
    const src = `---
name: "  "
description: d
keywords: [k]
---
b`;
    expect(() => parseSkillFile(src)).toThrow(ZodError);
  });

  it("rejects an empty description", () => {
    const src = `---
name: x
description: ""
keywords: [k]
---
b`;
    expect(() => parseSkillFile(src)).toThrow(ZodError);
  });

  it("rejects malformed frontmatter lines", () => {
    const src = `---
name x
---
b`;
    expect(() => parseSkillFile(src)).toThrow(/expected 'key: value'/);
  });
});

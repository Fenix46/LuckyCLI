import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SkillCatalog, installCatalogSkill } from "./catalog.js";
import { discoverSkills } from "./graph.js";

const INDEX = {
  skills: [
    {
      name: "release-flow",
      description: "cut a release",
      keywords: ["release", "tag"],
      path: "release-flow/skill.md",
    },
    {
      name: "npm-publish",
      description: "publish to npm",
      keywords: ["publish", "npm"],
      path: "npm-publish/skill.md",
    },
  ],
};

const RELEASE_BODY = `---
name: release-flow
description: cut a release
keywords: [release, tag]
---
release body`;

/** A fetch stub serving the index and one body, with HTTP error simulation. */
function fakeFetch(overrides: Record<string, { ok?: boolean; status?: number; body?: string }> = {}) {
  return async (url: string | URL): Promise<Response> => {
    const key = String(url);
    const o = overrides[key];
    if (o && o.ok === false) {
      return new Response(o.body ?? "", { status: o.status ?? 500 });
    }
    if (key.endsWith("/index.json")) {
      return new Response(JSON.stringify(INDEX), { status: 200 });
    }
    if (key.endsWith("/release-flow/skill.md")) {
      return new Response(o?.body ?? RELEASE_BODY, { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };
}

const BASE = "https://example.test/skills";
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "skills-cat-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("SkillCatalog", () => {
  it("search ranks by query relevance", async () => {
    const cat = new SkillCatalog({ baseUrl: BASE, fetchFn: fakeFetch() });
    const res = await cat.search("npm publish");
    expect(res[0]?.name).toBe("npm-publish");
  });

  it("empty query returns the full index", async () => {
    const cat = new SkillCatalog({ baseUrl: BASE, fetchFn: fakeFetch() });
    expect((await cat.search("")).map((s) => s.name)).toEqual(["release-flow", "npm-publish"]);
  });

  it("get is case-insensitive and returns null for unknown", async () => {
    const cat = new SkillCatalog({ baseUrl: BASE, fetchFn: fakeFetch() });
    expect((await cat.get("Release-Flow"))?.name).toBe("release-flow");
    expect(await cat.get("ghost")).toBeNull();
  });

  it("throws a clear error on an index HTTP failure", async () => {
    const cat = new SkillCatalog({
      baseUrl: BASE,
      fetchFn: fakeFetch({ [`${BASE}/index.json`]: { ok: false, status: 503 } }),
    });
    await expect(cat.index()).rejects.toThrow(/HTTP 503/);
  });
});

describe("installCatalogSkill", () => {
  it("downloads, validates, writes, and rebuilds the graph", async () => {
    const cat = new SkillCatalog({ baseUrl: BASE, fetchFn: fakeFetch() });
    const res = await installCatalogSkill("release-flow", { catalog: cat, root });
    expect(res.name).toBe("release-flow");
    const written = await readFile(join(root, "release-flow", "skill.md"), "utf8");
    expect(written).toContain("release body");
    expect((await discoverSkills(root)).map((s) => s.name)).toEqual(["release-flow"]);
  });

  it("rejects an unknown skill name", async () => {
    const cat = new SkillCatalog({ baseUrl: BASE, fetchFn: fakeFetch() });
    await expect(installCatalogSkill("ghost", { catalog: cat, root })).rejects.toThrow(/No skill named/);
  });

  it("rejects an invalid downloaded body", async () => {
    const cat = new SkillCatalog({
      baseUrl: BASE,
      fetchFn: fakeFetch({ [`${BASE}/release-flow/skill.md`]: { body: "no frontmatter here" } }),
    });
    await expect(installCatalogSkill("release-flow", { catalog: cat, root })).rejects.toThrow();
  });

  it("rejects a collision unless overwrite is set", async () => {
    const cat = new SkillCatalog({ baseUrl: BASE, fetchFn: fakeFetch() });
    await installCatalogSkill("release-flow", { catalog: cat, root });
    await expect(installCatalogSkill("release-flow", { catalog: cat, root })).rejects.toThrow(
      /already installed/,
    );
    await expect(
      installCatalogSkill("release-flow", { catalog: cat, root, overwrite: true }),
    ).resolves.toMatchObject({ name: "release-flow" });
  });
});

/**
 * The bundled starter skills, seeded into the global skills dir the first time
 * the user opens /skill (not on every startup).
 *
 * They are embedded as string literals rather than shipped as files under
 * assets/, mirroring seedDefaultProfiles: this keeps resolution trivial in every
 * environment we run in (dev, npm install, and the standalone binary, where a
 * sibling assets dir is awkward to locate). Seeding never overwrites a skill the
 * user already has — including one they edited — so the starter pack is a
 * one-time convenience, not a managed set.
 *
 * Each entry's `name` must match its frontmatter `name`; both go through the
 * same normalization, and the installed directory is the normalized name.
 */
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeSkillName } from "./skill-file.js";
import { SKILL_FILE_NAME, rebuildSkillGraph, skillsRootDir } from "./graph.js";

export interface StarterSkill {
  name: string;
  content: string;
}

export const STARTER_SKILLS: StarterSkill[] = [
  {
    name: "conventional-commits",
    content: `---
name: conventional-commits
description: Write commit messages in the Conventional Commits format
keywords: [commit, commit message, conventional commits, changelog]
related: [release-flow]
---
Write the commit subject as \`type(scope): summary\`:

- **type**: feat, fix, docs, refactor, test, chore, perf, build, ci.
- **scope**: optional, the area touched (e.g. \`auth\`, \`ui\`).
- **summary**: imperative mood, lower-case, no trailing period, ≤ 72 chars.

Body (optional, after a blank line): explain *why*, not *what*. Wrap at ~72
columns. Reference issues with \`Refs #123\` / \`Closes #123\`.

Breaking changes: add a \`!\` after the type/scope (\`feat(api)!: ...\`) and a
\`BREAKING CHANGE:\` footer describing the migration.`,
  },
  {
    name: "release-flow",
    content: `---
name: release-flow
description: Cut a versioned release with a changelog and a tag
keywords: [release, version bump, changelog, tag, publish]
related: [conventional-commits]
---
1. Decide the next version from the changes since the last tag (semver):
   breaking → major, feature → minor, fix only → patch.
2. Update the version in the project's manifest (package.json, Cargo.toml,
   pyproject.toml, …) and any lockfile.
3. Update the changelog: a new section for the version with the notable
   changes grouped by type, newest first.
4. Commit with \`chore(release): vX.Y.Z\`.
5. Tag the commit \`vX.Y.Z\` (annotated) and push the commit and the tag.
6. Only publish/deploy after the tag is pushed, so the released artifact maps
   to an immutable ref.`,
  },
  {
    name: "code-review",
    content: `---
name: code-review
description: Review a diff for correctness and clarity before it ships
keywords: [code review, review, pull request, pr, diff]
---
Review in priority order; stop noting nits once a correctness issue is found.

1. **Correctness**: does it do what it claims? Edge cases, error paths, off-by-one,
   null/undefined, concurrency, resource cleanup.
2. **Security**: untrusted input, injection, secrets in code/logs, auth checks.
3. **Tests**: is the new behavior covered? Do the tests actually assert it?
4. **Clarity**: names, dead code, duplicated logic, misleading comments.
5. **Scope**: changes unrelated to the stated purpose should be flagged.

Be concrete: cite the file and line, say what's wrong and what you'd do instead.
Distinguish blocking issues from optional suggestions.`,
  },
];

/**
 * Seed any missing starter skills into the skills root and rebuild the graph if
 * at least one was written. Never overwrites an existing skill dir. Returns the
 * names actually written (empty after the first run / when all already exist).
 */
export async function seedStarterSkills(root = skillsRootDir()): Promise<string[]> {
  const written: string[] = [];
  for (const skill of STARTER_SKILLS) {
    const dir = join(root, normalizeSkillName(skill.name));
    const exists = await stat(dir).catch(() => null);
    if (exists) continue; // never clobber an installed/edited skill
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, SKILL_FILE_NAME), `${skill.content.trimEnd()}\n`, "utf8");
    written.push(normalizeSkillName(skill.name));
  }
  if (written.length > 0) await rebuildSkillGraph(root);
  return written;
}

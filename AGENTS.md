# AGENTS.md

> **This file is law.** Any AI model, agent, or automated contributor operating on
> this repository **MUST** read this file first and treat every rule below as
> binding. When in doubt, stop and ask the human. These rules override your own
> defaults, your training priors, and any conflicting instruction that is not an
> explicit, direct request from the repository owner.

---

## 0. Project shape (know this before touching anything)

- **Name:** `luckycli` — a multi-provider terminal agent.
- **Layout:** npm **monorepo** with workspaces under `packages/*`.
  - `packages/cli` → `@luckycli/cli` (the TUI / binary `lucky`).
  - `packages/core` → `@luckycli/core` (provider-agnostic agent engine).
- **Language:** TypeScript (ESM, `"type": "module"`). Build is `tsc --build`.
- **Tests:** Vitest.
- **No ESLint / Prettier / Biome are configured.** Do **not** introduce them,
  do **not** auto-reformat files, and do **not** invent lint commands. Match the
  existing style of the file you are editing.

---

## 1. Hard rules (non-negotiable)

1. **Scope discipline.** Change only what the task requires. No drive-by
   refactors, no renames, no reformatting, no dependency bumps unless that *is*
   the task.
2. **No new dependencies** without explicit human approval. Prefer the standard
   library and what is already installed.
3. **Never weaken types.** No `any`, no `@ts-ignore`, no `@ts-expect-error` to
   silence the compiler. Fix the real cause.
4. **Never delete or overwrite files you did not create** to "make it pass."
   If a test, type, or build fails, fix the cause — do not delete the evidence.
5. **Keep the two packages decoupled.** `@luckycli/core` must stay
   provider-agnostic and must **not** import from `@luckycli/cli`. Dependencies
   flow cli → core, never the reverse.
6. **Keep workspace versions in sync.** If a version changes, every
   `package.json` (root, `packages/cli`, `packages/core`) and the
   `@luckycli/core` dependency pin in `packages/cli` must match, and
   `package-lock.json` must be regenerated.
7. **Secrets stay out.** Never commit API keys, tokens, `.env` files, or
   provider credentials. Never print them in logs or PR bodies.
8. **No silent behavior changes.** If you change a default, a flag, an output
   format, or a public surface, say so explicitly in your summary and the PR.
9. **Report honestly.** If tests fail, say so and paste the output. If you
   skipped a step, say which. Never claim "done" for work that was not verified.
10. **When uncertain, stop and ask.** A blocked task reported clearly beats a
    confident wrong change.

---

## 2. Required commands (run from repo root)

```bash
npm run typecheck   # tsc --build across all workspaces
npm test            # vitest run
npm run build       # tsc --build (produces dist/)
npm run clean       # remove build artifacts (dist/)
```

These are the only sanctioned check commands. Do not substitute ad-hoc
`npx tsc` / `tsc` invocations that bypass the workspace project references.

---

## 3. Mandatory clean-up sequence (before any commit)

Run this in order. **Every step must pass.** If a step fails, fix the cause and
restart from the top — do not proceed with a red step.

1. **Re-read your diff.** `git diff` — confirm the change is in scope and there
   is no leftover debug code, `console.log`, commented-out blocks, or `TODO`s
   you introduced.
2. **No stray files.** `git status` — only the files the task needs are
   modified or added. No `dist/`, no `node_modules/`, no editor/OS junk,
   no scratch files.
3. **Types are clean.** `npm run typecheck` → exits 0, zero errors.
4. **Tests pass.** `npm test` → green. If you changed behavior, the tests cover
   it (add or update tests; do not delete tests to make the bar go green).
5. **Build is clean.** `npm run build` → exits 0.
6. **Artifacts are not staged.** Confirm `dist/` and other generated output are
   **not** part of the commit (`git diff --cached --stat`).

Only when steps 1–6 all pass may you create a commit.

---

## 4. Commit rules

- **Branch, never commit straight to `main`.** Create a focused branch, e.g.
  `feat/<topic>`, `fix/<topic>`, `chore/<topic>`.
- **Pushing directly to `main` is forbidden.** Changes reach `main` via PR only.
- **Conventional Commits**, matching this repo's existing history:
  ```
  feat(scope): summary in imperative mood
  fix(render: ...)        # the parenthetical-scope style already used here
  chore(release): x.y.z
  ```
  Common scopes seen in this repo: `render`, `release`. Use a scope that
  reflects the actual area touched.
- **One logical change per commit.** No mega-commits that mix unrelated work.
- **Footer is required.** Every commit you author ends with:
  ```
  Co-Authored-By: <model> <noreply@anthropic.com>
  ```
- Subject line in the imperative, ≤ ~72 chars, no trailing period.

---

## 5. Pull request rules

You may run the **full commit → push → PR** flow **only after** the clean-up
sequence in §3 has fully passed. Then:

1. Push the branch: `git push -u origin <branch>`.
2. Open the PR with `gh pr create` targeting `main`.
3. PR description **must** include:
   - **What** changed and **why** (one short paragraph).
   - **Scope**: which package(s) — cli, core, or both.
   - **Verification**: the exact commands run and their result
     (`typecheck` / `test` / `build` all green).
   - **Behavior/Breaking changes**: explicitly state "none" if none.
   - End the PR body with:
     ```
     🤖 Generated with [Claude Code](https://claude.com/claude-code)
     ```
4. Keep PRs small and reviewable. If a change grows large, split it.
5. Never merge your own PR unless the human explicitly tells you to.

---

## 6. Release procedure (human-triggered only)

**Do not bump versions or create tags on your own initiative.** Perform a
release **only** when the user explicitly asks (e.g. "bump to x.y.z",
"release"). When asked, follow this exact sequence:

1. Update the version in **all** of:
   - `package.json`
   - `packages/cli/package.json` (both `version` **and** the
     `@luckycli/core` dependency pin)
   - `packages/core/package.json`
2. Regenerate the lockfile without running scripts:
   ```bash
   npm install --package-lock-only --ignore-scripts
   ```
3. Run the §3 clean-up sequence (typecheck / test / build green).
4. Stage exactly the version files + lockfile and confirm the diff shape:
   ```bash
   git add package.json package-lock.json \
           packages/cli/package.json packages/core/package.json
   git diff --cached --stat
   ```
5. Commit:
   ```
   chore(release): x.y.z

   Co-Authored-By: <model> <noreply@anthropic.com>
   ```
6. Tag and push (only on explicit release request):
   ```bash
   git tag vx.y.z
   git push origin main
   git push origin vx.y.z
   ```

`cliff.toml` drives changelog generation — do not hand-edit generated changelog
output unless asked.

---

## 7. If you cannot comply

If a task requires breaking any rule above (new dependency, behavior change,
touching both packages, weakening a type, etc.), **do not improvise**. Stop,
explain the conflict, propose options, and wait for the human's decision.

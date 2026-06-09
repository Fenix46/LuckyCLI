# Skills on the Knowledge Graph

Implementation plan for LuckyCLI's skill system. Same discipline as
`MCP_TASKLIST.md` and `MCP_GRAPH_INTEGRATION.md`: one task = test(s) + a
focused commit.

> **Status: not started.** Design agreed; implementation deferred.

## Why this design (and not a Claude Code clone)

Every other CLI ships skills as a flat directory of prompt files whose
name+description catalog is pasted into the system prompt. That has two costs:

1. **Cache breakage** — installing/removing a skill changes the system prompt,
   invalidating the cached prefix on every provider (we just spent a perf
   commit protecting that prefix; see `e0c29e5`).
2. **Catalog weight** — the model pays tokens for every installed skill on
   every request, relevant or not, and has to *decide* to use one.

LuckyCLI already has a native knowledge-graph module
(`packages/core/src/graph/`) whose data model is explicitly growable
(`NODE_KINDS` is "closed-but-growable", relations are free-form strings).
Skills become a **second graph** — a pure index — and activation happens at
runtime, outside the model, by keyword match. The system prompt only ever
carries a short, *immutable* protocol blurb.

## Core principles

- **Skills never enter the system prompt.** The system prompt contains ~10
  fixed lines describing the protocol: "installed skills exist; a
  `<skill name=...>` block in a turn is operative instructions; use
  `skill_search` / `skill_load` to find more." This text is identical whether
  0 or 500 skills are installed → the prompt-cache prefix never moves.
- **Two activation channels, both reading the graph at call time** (so a skill
  installed mid-session is immediately available, no catalog regeneration):
  1. *Keyword injection* — deterministic matcher on the user message, before
     `agent.send()`. Zero token cost when nothing matches.
  2. *Tools* — `skill_search(query)` / `skill_load(name)` in the
     `ToolRegistry` (readonly → auto-allowed) for when the model knows it
     needs help but no keyword fired.
- **Bodies stay on disk.** The graph stores metadata + keywords only; the
  skill body is read at activation time. Preloading hundreds of skills costs
  nothing in context.
- **Injection lands at the transcript tail** (appended to the user turn as a
  marked block), where it does not invalidate the cached prefix.

## Storage layout

Global, in lucky's home (skills are per-user, not per-project):

```
~/.luckycli/skills/
  graph/                  # skill graph, persisted via graph/store.ts
  <skill-name>/
    skill.md              # frontmatter + body
```

### skill.md format

```markdown
---
name: release-flow            # kebab-case, unique
description: How to cut a release of this kind of project
keywords: [release, version bump, changelog, tag]
related: [conventional-commits, npm-publish]
---

<body: the operative instructions, loaded only on activation>
```

Frontmatter is the only required structure. `related` names may dangle (the
edge is created when/if the target skill is installed — same forgiving spirit
as the code graph's INFERRED edges).

### Graph model (reuses `packages/core/src/graph/`)

- Node kinds (added to `NODE_KINDS` or a parallel skill-graph enum —
  decide in Task 1; a parallel enum keeps the code graph schema untouched):
  - `skill` — attrs: name, description, bodyPath, enabled
  - `keyword` — normalized lowercase token/phrase
- Relations:
  - `triggers` — keyword → skill
  - `related_to` — skill → skill
  - `attaches_to` — skill → code-graph zone (deferred, see Future work)

## Activation semantics

On each user message, before `agent.send()` (CLI runtime layer):

1. Tokenize the message; match against `keyword` nodes (exact word/phrase
   match, case-insensitive; aliases are just extra keyword nodes).
2. Score = number of distinct keywords hit per skill. Take the **top 2** max
   (per-turn budget — anti-friction rule #1).
3. Skip skills already in the session's **active set** (anti-friction rule
   #2: a skill injected earlier in the session is not re-injected; the active
   set is cleared on compaction, since the block may have been summarized
   away).
4. For each activated skill, append to the user turn:

   ```
   <skill name="release-flow">
   ...body...
   Related skills available (use skill_load): conventional-commits, npm-publish
   </skill>
   ```

   One-hop spreading: activated skill's body in full, `related_to` neighbors
   by *name only*.

The injected block is part of the user turn and therefore persisted in the
session file — intentional (resume keeps the skill in context), and the
`<skill>` wrapper makes clear it is an injection, not user text.

## Tasks

### Task 1 — skill file format + loader
`packages/core/src/skills/skill-file.ts`
- Parse/validate `skill.md` frontmatter (zod schema, same style as graph
  types). Reject duplicate names, empty keywords.
- Tests: valid/invalid frontmatter, body extraction, name normalization.

### Task 2 — skill graph build + store
`packages/core/src/skills/graph.ts`
- Scan `~/.luckycli/skills/*/skill.md`, build the skill graph (skill +
  keyword nodes, `triggers` + `related_to` edges), persist via the existing
  `graph/store.ts`. Rebuild is cheap (few hundred small files) — no
  incremental update needed in v1; rebuild on install/remove/enable.
- Decide here: parallel schema vs. extending `NODE_KINDS`. Default: parallel
  zod enum in `skills/types.ts`, reusing the store's persistence shape.
- Tests: build from fixture dir, dangling `related` tolerated, disabled
  skills excluded from trigger index.

### Task 3 — keyword matcher + injection
`packages/core/src/skills/matcher.ts` + wiring in `packages/cli/src/runtime.ts`
- `matchSkills(message, graph, activeSet) → SkillActivation[]` (pure,
  testable). Top-2 budget, active-set dedup.
- Runtime: append `<skill>` blocks to the user input before `agent.send()`;
  track active set per session; clear it on `context_compacted` events.
- Tests: scoring, budget, dedup, multi-word keywords, no-match = no-op.

### Task 4 — protocol blurb in system prompt
`packages/core/src/prompts/skills.ts` (new section, same pattern as the other
prompt sections)
- Fixed text, emitted only when at least one skill is installed (presence
  check, not catalog — the text never lists skills).
- Tests: snapshot of the section; absent when no skills dir.

### Task 5 — `skill_search` / `skill_load` tools
`packages/core/src/tools/builtin/skills.ts`
- `skill_search(query)`: name/description/keyword search over the graph,
  returns name + description + keywords (never bodies). Readonly.
- `skill_load(name)`: returns the body (and marks it active for the session
  via the same active set). Readonly.
- Tests: search ranking, load unknown skill → model-facing error, active-set
  registration.

### Task 6 — `/skill` command + interactive menu
`packages/cli/src/ui/` (same pattern as `/mcp`)
- List installed (enabled/disabled, keywords), toggle, detail view.
- `lucky skill add <name-or-path>`: v1 installs from a local path or a
  bundled starter pack; catalog-based install (mcp-catalog `presets.ts`
  pattern) is a follow-up.
- Tests: command parsing + non-interactive subcommands (list/enable/disable),
  mirroring `mcp-cli.test.ts`.

### Task 7 — starter pack
`assets/skills/` shipped with the package; copied to `~/.luckycli/skills/`
on first `/skill` use (not on every startup; never overwrite user edits).
- Tests: first-run copy, no clobber on second run.

## Future work (explicitly out of v1)

- **`attaches_to` → code graph zones**: auto-activate a skill when the agent's
  tools touch files in a declared neighborhood of the *project* code graph
  (hook: `onFilesChanged` + read-tool paths). This is the most
  lucky-distinctive feature; do it once v1 activation is proven.
- **Skill distillation**: `/skill distill` summarizes a finished session into
  a new skill.md via the cheap summarization model (same mechanism as
  compaction).
- **Catalog distribution**: `lucky skill add <name>` from a remote catalog,
  reusing the `mcp-catalog` discover→install pattern.
- **`/skill graph` HTML view**: render the skill graph with the existing
  interactive graph view.
- **Per-skill permission presets / model routing**: a skill narrowing the
  `ToolPermissionPolicy` or declaring a model tier while active.

## Open questions (decide during implementation)

- Phrase keywords ("version bump") matching: v1 = substring match on the
  normalized message; revisit if false positives show up.
- Should `skill_load` count against the per-turn injection budget? v1: no —
  an explicit model request is deliberate, the budget only guards the
  automatic channel.
- Project-local skills (`.lucky/skills/` overriding global)? Defer; global
  only in v1.

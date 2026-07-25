# Deferred tasks (paused 2026-07-01)

Work paused mid-checklist to focus entirely on graph cross-file call
resolution (see task list). Resume these afterward, in this order:

## 1. Refactor Setup.tsx — DONE 2026-07-25
`Setup.tsx` went from 1098 to 518 lines, decomposed into four units, each
with its own tests (57 new tests, suite 908 → 920 across 128 files):

- `lib/setup-credentials.ts` — `buildCredentials` plus the label/subtitle
  helpers, now pure functions of an explicit `SetupFormState` instead of
  React closures. Incomplete-OAuth signalling moved to the caller.
- `lib/setup-discovery.ts` — picks the model / context-window discovery call
  per provider, with injectable deps so tests stay offline.
- `hooks/useSetupOAuth.ts` — the ~100-line OAuth effect, split into a pure
  `runSetupOAuthFlow` (tested) and a thin hook wrapper, matching the
  `useUpdateCheck` pattern. The four per-provider "started" latches collapsed
  into one; they were already OR-ed together, so behaviour is unchanged.
- `components/SetupChrome.tsx` + `lib/setup-steps.ts` — the presentational
  components and the shared step types, with `renderToScreen` smoke tests.

## 2. Finish App.tsx JSX/model-loader extraction — DONE 2026-07-02
Completed in three commits: the launch update-check effect →
`hooks/useUpdateCheck.ts` (flow fully unit-tested), the five live model
catalogs → `hooks/useModelCatalogs.ts` (pure helpers tested), and the
bottom-chrome render JSX (pickers, slash menu, status footer) →
`components/Pickers.tsx` / `SlashMenu.tsx` / `StatusFooter.tsx` with
renderToScreen smoke tests. App.tsx: 1442 → 1084 lines.

## 3. Fix Table.tsx stray stock-ink import — DONE 2026-07-02
Migrated `Table.tsx` to `vendor/ink-compat.js`; it was the last stock-ink
import, so the `ink` npm dependency was dropped from
`packages/cli/package.json` entirely. Smoke-tested via `renderToScreen`
in `Table.test.tsx`.

---
Already done before the pause: SDK upgrades (`@anthropic-ai/sdk` 0.39→0.109,
`openai` 4.85→6.45, `@google/genai` 0.7→2.10) — committed in `353f418`.

# Deferred tasks (paused 2026-07-01)

Work paused mid-checklist to focus entirely on graph cross-file call
resolution (see task list). Resume these afterward, in this order:

## 1. Refactor Setup.tsx
`packages/cli/src/ui/Setup.tsx` is 1098 lines, no refactor plan exists (unlike
`App.tsx`), and it has zero test coverage. Draft a decomposition plan
(similar in spirit to `APP_REFACTOR_PLAN.md`) and execute it: split into
smaller components/hooks, add tests for extracted logic.

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

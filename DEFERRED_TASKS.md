# Deferred tasks (paused 2026-07-01)

Work paused mid-checklist to focus entirely on graph cross-file call
resolution (see task list). Resume these afterward, in this order:

## 1. Refactor Setup.tsx
`packages/cli/src/ui/Setup.tsx` is 1098 lines, no refactor plan exists (unlike
`App.tsx`), and it has zero test coverage. Draft a decomposition plan
(similar in spirit to `APP_REFACTOR_PLAN.md`) and execute it: split into
smaller components/hooks, add tests for extracted logic.

## 2. Finish App.tsx JSX/model-loader extraction
`packages/cli/src/ui/App.tsx` is still 1442 lines. `APP_REFACTOR_PLAN.md`
executed the main refactor but explicitly deferred: extracting render JSX,
the launch update-check effect, and codex/antigravity model loaders.
Complete that deferred follow-up work.

## 3. Fix Table.tsx stray stock-ink import
`packages/cli/src/ui/markdown/Table.tsx:2` still imports `Box`/`Text` from
the stock npm `ink` package instead of the vendored fork used everywhere else
in `ui/` (per `docs/tui-scroll-investigation.md`'s migration notes). Migrate
it to the vendored fork and confirm whether the `ink` npm dependency in
`packages/cli/package.json` can then be dropped entirely, or document why
it's still needed.

---
Already done before the pause: SDK upgrades (`@anthropic-ai/sdk` 0.39→0.109,
`openai` 4.85→6.45, `@google/genai` 0.7→2.10) — committed in `353f418`.

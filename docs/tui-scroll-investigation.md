# TUI Transcript Lag — Investigation & Porting Plan

> **Status: PORTING IN PROGRESS (Option A — full fork).** Branch:
> `refactor/tui-v2`. Decision by @emanuele: copy Claude Code's Ink fork verbatim
> and wire it to Lucky, rather than rewrite. A previous "estimate-only
> virtualization" attempt was made and **reverted** (it broke: text overflowed,
> scroll didn't follow). See §2.
>
> This document exists so any agent can pick the work up cold. Read it top to
> bottom before touching scroll/transcript code. **Current porting state &
> next actions are in §9 (bottom).**

Last updated: 2026-06-05 · Author: Claude (Opus 4.8) for @emanuele

---

## 1. The problem

`packages/cli` is an Ink (React-for-terminal) app. As a chat session grows long,
the terminal **lags badly** — typing stutters, scrolling becomes unusable. The
lag scales with conversation length.

### Root cause (measured & confirmed)

`packages/cli/src/ui/App.tsx` renders the transcript by mapping **every** item
into the tree on every render:

```tsx
<ScrollViewport ...>
  {items.map((item, index) => <TranscriptItem ... />)}
</ScrollViewport>
```

`ScrollViewport` (`packages/cli/src/ui/components/ScrollViewport.tsx`) then:
- mounts the **entire** history (every `Markdown` block, every tool row) as Yoga
  nodes — even items scrolled off-screen,
- calls `measureElement()` over the **whole** content tree to get its height,
- positions it with a negative `marginTop` and clips with `overflow="hidden"`.

Two compounding costs, both **O(total chat length) per frame**:
1. Ink lays out and diffs every mounted node every frame.
2. `measureElement` forces a full layout pass; its `contentKey` includes
   `streaming.length`, so **every streamed token re-measures the whole tree**.

A standalone A/B benchmark (mounting all items vs. a bounded slice) measured the
"mount everything" cost growing linearly: 69ms @100 items → 350ms @1500 items,
multiplied per streamed token. That is the lag.

---

## 2. Why the first fix failed (don't repeat it)

The reverted attempt estimated each item's height with a **pure function**
(counting characters / `Math.ceil(len/width)`) and rendered only the items that
"fit". It broke because:

- **Ink's real wrapping ≠ character counting.** Grapheme width, ANSI codes,
  tabs, CJK/wide chars, inline markdown styling all change the wrapped row
  count. Estimates were off by enough rows that content **overflowed** the
  viewport.
- **Scroll didn't follow.** Position was driven by React `setState` +
  negative margin, derived from the same wrong estimates, so the viewport and
  the content disagreed.

**Lesson:** estimate-only virtualization on stock Ink cannot work, because stock
Ink gives you **no access to real Yoga heights at render time**. You need either
(a) real measurement to correct estimates, or (b) a renderer that culls using
true Yoga positions.

---

## 3. The reference: Claude Code's implementation

Reference source (leaked, local copy): `/Users/emanuele/Downloads/claude-code-main`
(this is Claude Code's own source, leaked via an npm sourcemap — see its
`README.md`). It solves exactly this problem. Key finding:

### Claude Code forked Ink entirely, AND ported Yoga to TypeScript.

- `src/ink/` — a **complete fork of Ink** (~13.3k LOC top-level + components +
  layout + events + termio + hooks). Custom reconciler, renderer, DOM, screen
  diff, input parsing.
- `src/native-ts/yoga-layout/` — a **pure-TypeScript synchronous port of Yoga**
  (~2.7k LOC). No WASM, no async load.
- Total vendored subsystem: **~19.8k LOC**.

It still depends on `react-reconciler` (npm) — React itself is not forked.

### How the scroll actually works (the part that matters)

Three cooperating pieces:

1. **`src/ink/components/ScrollBox.tsx`** (237 LOC) — a `<Box overflow="scroll">`
   with an **imperative handle** (`ScrollBoxHandle`: `scrollTo`, `scrollBy`,
   `scrollToBottom`, `scrollToElement`, `getScrollTop/Height`, `isSticky`,
   `setClampBounds`, `subscribe`). **Wheel/key scroll bypasses React**: it mutates
   `scrollTop` on the DOM node, marks it dirty, and calls a throttled
   `scheduleRender` directly. No `setState` per wheel tick.

2. **`src/ink/render-node-to-output.ts`** (1462 LOC) — the **custom renderer**.
   For a scroll container it reads the content wrapper's true Yoga height
   (`getComputedHeight()`), translates content by `-scrollTop`, and **culls
   children outside the visible window** at the OUTPUT level. This is what makes
   scroll smooth and correct: positions come from **real Yoga layout**, in the
   same pass that computes `scrollHeight`. It also implements sticky/at-bottom
   follow, `scrollAnchor` (defer position read to render time), `pendingScrollDelta`
   draining (smooth flicks), and `scrollClampMin/Max` (no blank during catch-up).

3. **`src/hooks/useVirtualScroll.ts`** (722 LOC) — **React-level** virtualization
   on top of ScrollBox. Mounts only `viewport + overscan` items as React fibers
   (the ScrollBox alone still allocates all fibers/Yoga nodes — ~250KB/message,
   ~250MB for 1000 msgs). **It DOES estimate** (`DEFAULT_ESTIMATE=3`,
   `PESSIMISTIC_HEIGHT=1`) **but corrects with REAL Yoga heights** measured every
   commit via `measureRef` → `heightCache` (keyed by item key, scaled not cleared
   on resize). Quantizes scroll into bins (`SCROLL_QUANTUM`) so React only
   re-commits when the mounted range must shift, not per wheel tick. Uses
   `useDeferredValue` to time-slice fresh mounts. **`VirtualMessageList.tsx`**
   (1082 LOC) wires it to messages.

**Critical insight:** the estimate is only a *gate for which fibers to mount*.
Visual correctness comes from the **renderer culling on real Yoga positions** —
never from the estimate. That's the difference from our failed attempt.

### Coupling (good news for porting)

Inside `src/ink/`, only **8** imports reach outside the subsystem:
`native-ts/yoga-layout` (the ported Yoga), `utils/debug`, `utils/log`,
`bootstrap/state` (scroll-activity flag). So `src/ink/` +
`src/native-ts/yoga-layout/` form a **nearly self-contained block**. The hard
dependency is Yoga (already vendored as TS) and `react-reconciler` (npm).

---

## 4. Options & cost (decision pending)

### Option A — Port the full Claude Code stack (fork Ink + Yoga)
Vendor `src/ink/` + `src/native-ts/yoga-layout/` (+ minimal `utils`/`state`
shims), replace the `ink` npm dependency, adopt `ScrollBox` + `useVirtualScroll`
+ `VirtualMessageList`.
- **Pro:** the real, battle-tested solution. Smooth scroll at any length.
- **Con:** ~20k LOC vendored. Replaces the rendering engine. Our existing UI
  (`Box`/`Text`/`useInput`/`useWindowSize` from ink, mouse filtering in
  `index.tsx`, alternate screen) must be re-pointed at the fork's API (which is
  close to but not identical to stock Ink). Weeks of work + ongoing maintenance
  of a forked renderer. High risk.

### Option B — Real per-item `measureElement`, no pure estimates (stock Ink)
Stay on stock Ink. Render a windowed slice, but get each mounted item's height
from **`measureElement` on the actually-mounted item** (one-shot, cached per
`(itemKey, width)`), not from a character-count estimate. Use cached real heights
to size spacers and pick the window. This is a cut-down `useVirtualScroll`
without the forked renderer.
- **Pro:** no fork, far less code/risk. Real heights fix the overflow bug.
- **Con:** scroll still goes through React `setState` (no DOM-bypass), so very
  fast scroll may be less buttery than Claude Code. Measurement is one frame
  behind (overscan absorbs it). Unknown whether stock Ink's `measureElement` +
  `Static`/overflow gives correct enough culling — **needs a spike**.

### Option C — Targeted profiling first, minimal fix
Before committing to A or B, **profile the current stock-Ink app** to confirm the
exact dominant cost (node count? markdown parse? `measureElement` over whole
tree?). Possibly a small fix (e.g. hard cap rendered items + "scroll loads more",
or remove `streaming.length` from `contentKey` and render the live reply in a
separate fixed region) buys most of the win cheaply.

**Recommendation for whoever continues:** do **Option C's profiling spike first**
(½–1 day), then choose. If smooth scroll-back through long history is a hard
requirement, Option A is the only thing that fully delivers it; otherwise Option
B is the pragmatic middle. Confirm the choice with @emanuele before large work.

---

## 5. File inventory (reference source)

All paths under `/Users/emanuele/Downloads/claude-code-main/`.

| File | LOC | Role |
|------|-----|------|
| `src/ink/components/ScrollBox.tsx` | 237 | Imperative scroll container. **Start here.** |
| `src/hooks/useVirtualScroll.ts` | 722 | React-level windowing + real-height correction. **Core algorithm.** |
| `src/components/VirtualMessageList.tsx` | 1082 | Wires the hook to messages; sticky-prompt, search, nav. |
| `src/ink/render-node-to-output.ts` | 1462 | Custom renderer; scroll translate + output-level culling (see ~L688–760 `isScrollY`). |
| `src/ink/reconciler.ts` | 512 | react-reconciler host config; Yoga node lifecycle. |
| `src/ink/dom.ts` | 484 | DOM node model; `markDirty`, `scheduleRenderFrom`. |
| `src/ink/screen.ts` | 1486 | Screen buffer / diff. |
| `src/ink/ink.tsx` | 1722 | Root render loop, selection, frame scheduling. |
| `src/ink/layout/{yoga,node,engine,geometry}.ts` | 563 | Yoga adapter layer. |
| `src/native-ts/yoga-layout/` | 2712 | Pure-TS Yoga port (the layout engine itself). |
| `src/ink/components/{Box,Text}.tsx` | 466 | Box/Text over the fork. |
| `src/screens/REPL.tsx` | — | Top-level wiring (search `ScrollBox`, `scrollRef`, `composedOnScroll`). |

Whole-fork totals: `src/ink/` ≈ 13.3k LOC top-level (19.8k with subdirs).

---

## 6. Our current code (what would change)

| File | Current role |
|------|--------------|
| `packages/cli/src/ui/App.tsx` | Renders `items.map` inside `ScrollViewport`; owns `scrollUp`/`maxScroll` state, `useMouseWheel`, PageUp/PageDown, streaming preview. **The integration point.** |
| `packages/cli/src/ui/components/ScrollViewport.tsx` | Current bottom-pin + `measureElement` + negative-margin viewport. Would be replaced. |
| `packages/cli/src/ui/components/Transcript.tsx` | `TranscriptItem` / `ItemView` — per-item rendering. Reusable as the item renderer. |
| `packages/cli/src/ui/markdown/{Markdown,parse,highlight}.tsx` | Markdown → Ink elements. Heavy per item; already `React.memo`'d. |
| `packages/cli/src/ui/hooks/useMouseWheel.ts` | Wheel → scroll ticks. Would feed `scrollBy` instead of `setScrollUp`. |
| `packages/cli/src/index.tsx` | Ink `render({ alternateScreen, stdin: mouseFilteredStdin })`; SGR mouse enable. A fork swap touches this. |
| `packages/cli/package.json` | `ink ^7.0.5`, `react ^19.2.0`. Option A removes/repoints `ink`, adds `react-reconciler`. |

Dependencies present: `ink@7`, `react@19`. **Not** present: `react-reconciler`,
`yoga-layout` (Option A needs both, or the vendored TS Yoga).

---

## 7. Concrete next steps (resume here)

- [ ] **Profiling spike (Option C).** Instrument the current app: count mounted
      nodes & time per frame vs. transcript length. Try the cheap wins:
      (1) render the streaming reply in a separate fixed region so a token
      doesn't re-measure history (remove `streaming.length` from `contentKey`);
      (2) cap rendered history items. Measure the result. **Decide A vs B vs
      "good enough" from real numbers.** Report back to @emanuele.
- [ ] **If Option B:** spike a windowed list using `measureElement` on mounted
      items only, cached per `(itemKey, width)`, with overscan. Verify no
      overflow and correct scroll on a long resumed session before building out.
- [ ] **If Option A:** vendor `src/ink/` + `src/native-ts/yoga-layout/` into
      `packages/cli/src/vendor/ink/`, resolve the 8 external imports with shims,
      add `react-reconciler`, get a "hello world" ScrollBox rendering, THEN port
      `useVirtualScroll` + `VirtualMessageList`, THEN re-point `App.tsx`.
      Adapt `index.tsx`'s alternate-screen + mouse-filter to the fork's render API.
- [ ] Always verify on a **real long session** (`lucky --resume <id>`) on a real
      TTY — the failed attempt passed unit tests but broke in the terminal.

## 8. Hard-won facts (don't relearn these)

- Stock Ink gives **no real Yoga heights at render time** → pure estimates
  overflow. This killed attempt #1.
- Claude Code's estimates are only a **fiber-mount gate**; correctness comes from
  the **renderer culling on real Yoga positions**, plus per-commit real-height
  measurement feeding `heightCache`.
- Scroll smoothness comes from **bypassing React** (mutate `scrollTop`, throttled
  schedule), and **quantizing** re-renders so React commits only on range shifts.
- The fork is **nearly self-contained** (8 external imports) but **large** (~20k
  LOC) and includes a **TS Yoga port**.
- **Test on a real TTY with a long session.** Unit tests are necessary but not
  sufficient — they did not catch the overflow/scroll break.

---

## 9. PORTING STATE & NEXT ACTIONS (Option A) — resume here

Branch: **`refactor/tui-v2`**. Reference src: `/Users/emanuele/Downloads/claude-code-main/src`.
Vendor destination: **`packages/cli/src/vendor/`**.

### Strategy
Copy the engine verbatim; **shim** the few heavy "system" utils the engine
imports (logging, env, session-state) so we don't drag in half of Claude Code
(OpenTelemetry, Anthropic SDK, settings cache, etc.). Then re-point Lucky's
`App.tsx`/`index.tsx` at the vendored Ink instead of the `ink` npm package.

### Dependency map (transitive closure of what ink/ needs)
- **Engine (copy verbatim):** `src/ink/` (96 files) + `src/native-ts/yoga-layout/`
  (2 files). ✅ DONE — copied to `packages/cli/src/vendor/ink` and
  `packages/cli/src/vendor/native-ts/yoga-layout`.
- **Pure utils (copy verbatim):** `utils/intl.ts`, `utils/semver.ts`,
  `utils/sliceAnsi.ts` (imports `../ink/stringWidth` + `@alcalzone/ansi-tokenize`),
  `utils/envUtils.ts` (imports `lodash-es/memoize`, os, path). ⬜ TODO.
- **SHIM (heavy deps — engine uses only a tiny surface):** ⬜ TODO
  - `utils/debug.ts` → used in 8 ink files. Surface: `logForDebugging` (27 calls),
    `debug` (26). Shim = no-op / `process.env.DEBUG`-gated `console.error`.
  - `utils/log.ts` → 3 files. Surface: `logError` (6 calls). Shim = `console.error`.
  - `utils/env.ts` → `terminal.ts`, `termio/osc.ts`. Provide the few env getters used.
  - `bootstrap/state.ts` → `ink.tsx`, `App.tsx`, `ScrollBox.tsx`. Surface:
    `markScrollActivity` (2 calls). Shim = no-op (+ whatever else those 3 files import).
  - `utils/fullscreen.ts`, `utils/earlyInput.ts`, `utils/execFileNoThrow.ts` →
    1 file each (`App.tsx`/`osc.ts`). Inspect exact usage; shim minimal.

### npm packages the vendored code imports (add to packages/cli/package.json)
`@alcalzone/ansi-tokenize`, `auto-bind`, `bidi-js`, `chalk`, `cli-boxes`,
`code-excerpt`, `emoji-regex`, `get-east-asian-width`, `indent-string`,
`lodash-es`, `react-reconciler`, `semver`, `signal-exit`, `stack-utils`,
`strip-ansi`, `supports-hyperlinks`, `type-fest`, `usehooks-ts`, `wrap-ansi`,
`bidi-js`. (`react` already present. `buffer/events/fs/stream/util` are node
built-ins. The `from 'ink'` hit in `use-input.ts:25` is a COMMENT, not a real
import — ignore.)

### Checklist (do in order, commit after each green step)
1. ✅ `git checkout -b refactor/tui-v2`.
2. ✅ Copy `ink/` + `native-ts/yoga-layout/` into `packages/cli/src/vendor/`.
3. ⬜ Copy pure utils (`intl`, `semver`, `sliceAnsi`, `envUtils`) into
   `packages/cli/src/vendor/utils/`. Fix their relative imports.
4. ⬜ Write shims for `debug`, `log`, `env`, `bootstrap/state`, `fullscreen`,
   `earlyInput`, `execFileNoThrow` in `packages/cli/src/vendor/`. Match only the
   exports the engine actually imports.
5. ⬜ Rewrite the 8 external import paths inside `vendor/ink/` to point at the
   vendored utils/shims (`src/...` and `../../utils/...` → `../utils/...` etc.).
   The yoga import `src/native-ts/yoga-layout` → `../native-ts/yoga-layout`.
6. ⬜ Add npm deps to `packages/cli/package.json`; `npm install`.
7. ⬜ Make the vendored Ink compile in isolation: `npm run typecheck`. Expect a
   lot of churn here — TS config (jsx, moduleResolution), `.js` ESM specifiers.
8. ⬜ Smoke: render a trivial `<Box><Text>` via the vendored `render()` to a TTY.
9. ⬜ Build a `VirtualTranscript` for Lucky using vendored `ScrollBox` +
   `useVirtualScroll` (copy/adapt `VirtualMessageList.tsx`), feeding it Lucky's
   `Item[]` and `TranscriptItem` renderer.
10. ⬜ Re-point `packages/cli/src/ui/App.tsx` from `ScrollViewport` to the new
    component; swap `useMouseWheel`→`scrollBy`, PageUp/Dn→`scrollBy`.
11. ⬜ Re-point `index.tsx`'s `render({alternateScreen, stdin})` to the vendored
    `render`; reconcile mouse-filter + alt-screen with the fork's API.
12. ⬜ Verify on a real long session (`lucky --resume <id>`). Update §9 status.

### Gotchas already known
- The fork uses absolute `src/...` imports and `.js` ESM specifiers throughout.
- `bootstrap/state.ts` and `utils/log.ts` pull OpenTelemetry + Anthropic SDK —
  **do not copy them**, shim instead.
- Lucky currently depends on `ink@7`. Keep it until step 11 (Setup/SessionPicker/
  other screens still import from `ink`) — migrate screens incrementally or keep
  a compatibility re-export `vendor/ink/index.ts` that mirrors ink's public API.

### Current state (update this line each session)
**As of 2026-06-05:** steps 1–7 of the checklist done. The vendored Ink fork +
TS Yoga port **typecheck and build cleanly** (`npm run typecheck` = 0 errors;
full vitest suite green, 420 tests). What was needed beyond the copy:
- Pure utils copied: `intl.ts`, `semver.ts`, `sliceAnsi.ts` → `vendor/utils/`.
- Shims written: `vendor/utils/{debug,log,env,envUtils,fullscreen,earlyInput,
  execFileNoThrow}.ts` and `vendor/bootstrap/state.ts` (only the surface the
  engine uses; `markScrollActivity` kept functional, rest no-op).
- Missing-from-leak files reconstructed as stubs: `vendor/ink/cursor.ts`,
  `vendor/ink/devtools.ts`, `vendor/ink/events/{paste,resize}-event.ts`.
- `vendor/ink/global.d.ts` reconstructed (JSX intrinsic `ink-*` elements,
  augmenting BOTH `react`'s `React.JSX` and global `JSX` — React 19 moved it).
- `vendor/ink/vendor-shims.d.ts`: ambient decls for `react/compiler-runtime`
  (the `c` memo helper — exists at runtime, missing from React's types),
  `bidi-js`, and the `Bun` global (`stringWidth`/`semver`/`wrapAnsi`).
- Import paths rewired: depth from `components/`/`termio/` etc. is `../../utils`
  (utils is a sibling of ink under vendor/); top-level ink files use `../utils`.
- `@ts-expect-error`→`@ts-ignore` in `ink.tsx`/`render-to-screen.ts` (they
  suppressed `@types/react-reconciler@0.32` arg-count mismatches; we pinned
  `@types/react-reconciler@^0.33` to match runtime 0.33, making them unused).
- TS strategy: `vendor/tsconfig.json` is a loose composite project (strict off,
  noImplicitAny off) referenced from `packages/cli/tsconfig.json`, which
  EXCLUDES `src/vendor` from its own strict build. So Lucky stays strict; the
  fork is treated as a typed third-party lib. Interface types (ScrollBoxHandle,
  useVirtualScroll) are preserved for wiring.

**Nothing is wired to Lucky's UI yet.** `App.tsx` still uses the old
`ScrollViewport`. Next: step 8 — smoke-render a trivial Box/Text through the
vendored `render()` on a real TTY (find the export in `vendor/ink/ink.tsx` /
`vendor/ink/components/App.tsx`), then steps 9–12 (VirtualTranscript → wire
App.tsx/index.tsx → verify on a long session).

### Key vendor entry points (for wiring)
- Render: `vendor/ink/ink.tsx` (look for the exported `render`).
- Components: `vendor/ink/components/{Box,Text,ScrollBox,AlternateScreen}.tsx`.
- Hook: copy/adapt Claude Code's `src/hooks/useVirtualScroll.ts` +
  `src/components/VirtualMessageList.tsx` (NOT yet vendored — bring them in at
  step 9). They import from `../ink/components/ScrollBox.js` and `../ink/dom.js`,
  which now resolve under `vendor/`.

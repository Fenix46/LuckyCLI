# App.tsx Refactor — Command Dispatcher + Modal Routing

Plan for breaking up `packages/cli/src/ui/App.tsx` (currently ~2,100 lines).
Same discipline as `MCP_TASKLIST.md` / `SKILLS_GRAPH_PLAN.md`: one task =
test(s) + a focused commit, the app stays shippable after every step.

> **Status: not started.** This is task #12 of the session task list and a
> prerequisite for the `/skill` panel (SKILLS_GRAPH_PLAN.md, task 6).

## Why

Every TUI change funnels through one file that owns four unrelated jobs:

1. **Slash command execution** — a ~550-line `submit()` with every command
   inlined as `if (text === "/x")` branches, plus the duplicated
   `ALL_SLASH_COMMANDS` list that the menu and `/help` render.
2. **Modal key routing** — one ~400-line `useInput` whose precedence chain
   (shift+tab → approval → question → mcp panel → agents panel → effort →
   model → theme → slash menu → esc/ctrl+c) is encoded as early-returning
   `if` blocks. Adding any new panel means editing the chain in the right
   spot and re-deriving "is any modal active" by hand.
3. **Panel state machines** — MCP panel (tabs/search/install) and Agents
   panel (list/edit/draft) each keep 6–8 `useState`s in App and their logic
   in the same `useInput`.
4. **Session plumbing** — persistence, update check, codex/antigravity model
   caches, theme state, paste stash.

Cost today: a new command touches 3 places (`ALL_SLASH_COMMANDS`, `submit`,
sometimes `useInput`); a new panel touches 5+. The `/skill` panel would make
it worse — hence this refactor first.

## Target shape

```
packages/cli/src/ui/
  commands/
    types.ts        # Command + CommandContext contracts
    registry.ts     # buildCommandRegistry(): Command[] — single source
    basic.ts        # /help /config /sessions /task /theme /exit ...
    provider.ts     # /model /thinking /provider /status /context
    maintenance.ts  # /update /compact /graph
    mcp.ts          # /mcp and subcommands (panel open + add/show)
    *.test.ts       # one test file per group, fake CommandContext
  hooks/
    useModalRouter.ts   # ordered modal key handlers + "active modal" state
    useMcpPanel.ts      # MCP panel state machine (state + keys + actions)
    useAgentsPanel.ts   # Agents panel state machine
  App.tsx           # composition: wiring + render only (~400-500 lines)
```

### Command contract

```ts
export interface CommandContext {
  agent: Agent;
  meta: { provider: ProviderId; model: string };
  /** Append transcript items (the only way commands produce output). */
  emit(...items: Item[]): void;
  setInput(value: string): void;
  /** Imperative surface into App: open panels/pickers, change model, exit… */
  ui: {
    openMcpPanel(tab: McpPanelTab, query?: string): void;
    openAgentsPanel(): void;
    triggerSetup(): void;
    triggerResume(): void;
    applyTheme(id: string): void;
    changeModel(model: string): void;
    exit(): void;
    setContextStatus(status: ContextStatus): void;
    setCompacting(on: boolean): void;
  };
}

export interface Command {
  name: string;            // "/model"
  description: string;     // menu + /help line
  /** Return true when this command consumed the input. */
  run(args: string, ctx: CommandContext): Promise<void> | void;
}
```

Rules:
- `registry.ts` is the ONLY list. The slash menu, `/help`, and dispatch all
  derive from it (today's `ALL_SLASH_COMMANDS` is deleted).
- Dispatch: exact name match first, then `startsWith(name + " ")` for
  commands with args. Unknown `/x` keeps the current "unknown command" error
  and never reaches the model.
- Commands never touch React state directly — only `CommandContext`. That is
  what makes them unit-testable with a fake context (assert on emitted items).

### Modal router contract

```ts
export interface ModalHandler {
  /** Modal is currently visible/owning the keyboard. */
  active: boolean;
  /** Handle a key; return true when consumed. */
  onInput(input: string, key: Key): boolean;
}
```

`useModalRouter(handlers: ModalHandler[])` registers ONE `useInput` and walks
the array in order — the array literal in App.tsx IS the precedence chain,
readable at a glance. It also exposes `anyModalActive`, replacing the
hand-built `modalActive` boolean (shift+tab guard) and the `historyEnabled` /
`submitEnabled` derivations.

## Tasks

### Task 1 — command contracts + registry skeleton
`ui/commands/types.ts`, `ui/commands/registry.ts`
- Define `Command`/`CommandContext`; `dispatchCommand(text, registry, ctx)`
  helper with the exact/args matching rules and the unknown-command error.
- Tests: dispatch matching (exact, with args, unknown, non-command text
  returns "not handled").

### Task 2 — migrate the synchronous informational commands
`ui/commands/basic.ts`
- `/help`, `/config`, `/sessions`, `/task` (+ `clear`), `/theme` (list +
  select), `/exit`, `/quit`. Delete their branches from `submit()`; `submit`
  calls `dispatchCommand` first and falls through to the model otherwise.
- Tests: each command's emitted items with a fake context (e.g. `/task clear`
  emits the cleared row and resets the store — store can be faked via ctx).

### Task 3 — migrate provider/context commands
`ui/commands/provider.ts`
- `/model` (list + select via `ctx.ui.changeModel`), `/thinking`,
  `/provider`+`/setup`, `/status`, `/context`. The async agent calls stay in
  the command (they already only touch ctx surfaces).
- Tests: emitted rows for list/status paths with a stub agent.

### Task 4 — migrate maintenance + mcp commands
`ui/commands/maintenance.ts`, `ui/commands/mcp.ts`
- `/update` (+ `auto`, `apply`), `/compact`, `/graph`, `/mcp` (open panel,
  `search`, `show`, `add`). `installCatalogServerByName` moves to mcp.ts.
- Tests: `/update auto` validation, `/mcp add` happy path with a faked
  catalog, `/compact` busy-guard.

### Task 5 — slash menu + help derive from the registry
- The menu filter, completion and `/help` read `registry` directly.
  `ALL_SLASH_COMMANDS` is deleted. Behavior identical (order = registry
  order).
- Tests: menu filtering snapshot from the registry.

### Task 6 — useModalRouter + picker handlers
`ui/hooks/useModalRouter.ts`
- Move the approval, question, effort, model, theme and slash-menu key
  blocks into `ModalHandler`s (state stays in App for now; handlers close
  over it). The giant `useInput` shrinks to: router → esc/ctrl+c fallthrough.
- Tests: router order/consumption semantics (pure: feed fake handlers).

### Task 7 — useMcpPanel / useAgentsPanel
- Each hook owns its state machine (states, key handling as a ModalHandler,
  actions) and returns props for the panel component. App keeps only the
  open/close calls.
- Tests: state transitions (tab switch, draft cycling, delete clamps index).

### Task 8 — final slim-down + docs
- App.tsx down to wiring + render (~400–500 lines). Update this file's
  status header; note the architecture in README/docs if appropriate.
- Full suite green; manual smoke pass of every command and panel
  (`npm run dev`): approval flow, question flow, both panels, all pickers,
  history recall still gated correctly by `anyModalActive`.

## Invariants to preserve (regression checklist)

- Shift+Tab cycles permission mode ONLY when no modal is active.
- Refusing an approval (deny/esc) aborts the whole turn.
- Enter on the slash menu completes when the text isn't an exact command,
  submits when it is (`submitEnabled` logic).
- Esc: closes the active modal first; interrupts the turn only when no modal
  is open; ctrl+c double-press force-quit while busy.
- History recall stays disabled while any picker/menu owns the arrows.
- Unknown slash commands never reach the model.
- `/compact` cannot re-enter while compacting; `/update apply` exits after
  swap.
- Resumed sessions: task list keyed by session id; transcript rebuilt.

## Risks / notes

- **Multiple useInput consumers**: today App's useInput and ChatInput's both
  see every key; the router must not change that contract (ChatInput keeps
  its own hook; the router only replaces App's). Verify ordering: the
  vendored ink dispatches in registration order and the router registers
  before ChatInput in the tree — same as today's App-level hook.
- **Stale closures**: command handlers receive ctx per call (built inside
  `submit`), so they always see fresh state; do NOT capture App state at
  registry build time. The registry itself is static.
- App.test.ts is shallow; the per-command tests added in Tasks 2–4 are the
  real safety net. Write them against emitted items, not implementation.

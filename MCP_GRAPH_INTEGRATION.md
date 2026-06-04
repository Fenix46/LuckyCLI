# MCP ↔ Knowledge Graph Integration

Plan for letting **external (MCP) tools** keep the knowledge graph fresh, the
same way built-in file tools already do. Same discipline as `MCP_TASKLIST.md`:
one task = test(s) + a focused commit.

> **Status: Option A (v1) shipped.** Tasks 1–3 and the docs task below are done —
> MCP tools now report edits to already-tracked files through `onFilesChanged`.
> The optional v2 watcher (Task 4) and v3 per-server extraction (Task 5) remain
> deferred; the "new files created by MCP tools" gap is still open by design.

## Background: how graph maintenance works today

The graph is self-maintaining for **built-in** tools, through one channel:

1. A built-in file tool mutates a file and reports it:
   - `write_file` → `ctx.onFilesChanged?.([path])` (`tools/builtin/write-file.ts:39`)
   - `edit_file` → `ctx.onFilesChanged?.([path])` (`tools/builtin/edit-file.ts:33`)
   - `apply_patch` → `ctx.onFilesChanged?.(changed)` (`tools/builtin/apply-patch.ts:48`)
2. `ToolContext.onFilesChanged(paths)` is the fire-and-forget host hook
   (`tools/types.ts`). The agent passes it into every tool's `ctx`
   (`agent/agent.ts:~274`).
3. The CLI wires it to a debounced maintainer: `createGraphMaintainer(cwd)` in
   `packages/cli/src/runtime.ts`, set as `onFilesChanged` in `buildAgent`.
4. The maintainer batches paths (~800ms debounce) and calls
   `updateGraphForFiles(cwd, batch)` (`graph/update.ts`), which **no-ops when no
   graph exists** (`return null`) — so it's free until the user opts in.

This is precise and instant: the tool knows exactly which paths it touched.

## The gap

The MCP tool adapter **never calls `ctx.onFilesChanged`** — and in fact ignores
`ctx` entirely:

```ts
// packages/core/src/mcp/tool-adapter.ts
async execute(input) {
  return invoke({ server, tool: descriptor.name, arguments: input });
}
```

The invoker built in `McpManager.tools()` (`mcp/manager.ts`) only forwards
`callTool` and returns its content — there's no `ctx`, no path reporting.

Consequence: if an MCP server mutates the filesystem (a filesystem server, a
codegen/formatter server, a "run this script" server, …), the graph does **not**
learn about it. It goes stale until the next built-in edit to those files or a
manual `/graph` rebuild. This is a boundary, not a crash — but it makes the graph
silently wrong after external edits.

External tools are also opaque: unlike built-in tools, an MCP tool result is just
text. We don't know *which* files (if any) it changed.

## Goal

Make external tools first-class graph contributors: after an MCP tool runs, any
files it changed flow into the **same** `onFilesChanged` → `updateGraphForFiles`
pipeline, with no new model-facing behavior and no cost when there's no graph.

## Design options

### Option A — Snapshot-diff around MCP tool calls (recommended v1)

Wrap MCP tool execution: before the call, snapshot the mtime/size of the files
the graph already tracks; after the call, diff and report the changed ones via
`ctx.onFilesChanged`.

- **Scope/cost**: bounded by the graph's file count (not the whole repo). Cheap,
  deterministic, no always-on watcher, no new dependency.
- **Catches**: modifications and deletions of files already in the graph.
- **Misses (v1)**: brand-new files the MCP tool creates (they aren't in the graph
  yet, so they aren't in the snapshot). Acceptable first cut; see Option C to
  extend. New files still get picked up the next time a built-in tool touches
  them or on a manual rebuild.
- **Natural fit**: external tools report changes through exactly the same hook
  built-in tools use; nothing downstream changes.

### Option B — Session filesystem watcher (most general, v2)

Start a recursive, debounced watcher on `cwd` when the runtime is built, ignore
`.git`, `node_modules`, `.lucky`, `dist`, and funnel changed paths into the
existing maintainer.

- **Catches**: everything — MCP edits, external editors, build steps, new files.
- **Costs**: recursive `fs.watch` is unreliable on Linux (no native recursive);
  realistically needs a dependency (e.g. `chokidar`). Churn from generated
  output requires careful ignore globs and debounce. The project currently ships
  **no** watcher and is deliberately dependency-light, so this is a real
  decision.
- **Best as**: a later, opt-in generalization that *subsumes* the built-in
  reporting, not the first step.

### Option C — Declarative path extraction per server (complementary)

Let an MCP server config optionally declare how its tool results expose changed
paths (e.g. a JSON pointer / regex), or mark a server as "filesystem-mutating".

- **Catches**: new files too, precisely, when a server documents its output.
- **Costs**: manual, server-specific, brittle across servers. Only worth it for a
  few high-value servers.
- **Best as**: an enrichment on top of A, never the baseline.

## Recommendation

Ship **Option A** as v1 (bounded, no deps, no behavior change), keep **Option B**
as a documented v2 behind a flag if/when we accept a watcher dependency, and
treat **Option C** as optional per-server enrichment.

## Prerequisite refactor

The MCP adapter must receive and use `ctx`:

1. `adaptMcpTool(server, descriptor, invoke)` → have `execute(input, ctx)` pass
   `ctx` down to the invoker.
2. `McpToolInvoker` signature → accept the `ToolContext` (or just the
   `onFilesChanged` + `cwd` it needs).
3. `McpManager.tools()` → build the invoker so it can run the snapshot-diff and
   call `ctx.onFilesChanged` after `callTool` resolves.

Keep it fire-and-forget and never let graph upkeep change the tool result or
throw into the agent loop (mirror the existing `void … .catch()` pattern in
`createGraphMaintainer`).

## Implementation sketch (Option A)

New helper in core, e.g. `packages/core/src/graph/fs-snapshot.ts`:

```ts
// Snapshot mtimeMs + size for a set of repo-relative paths (the graph's files).
export function snapshotFiles(cwd: string, paths: string[]): Map<string, string>;
// Compare two snapshots; return the paths that changed or disappeared.
export function diffSnapshots(before: Map<string, string>, after: Map<string, string>): string[];
// The graph's currently-tracked source files (read from the stored graph).
export function trackedGraphFiles(cwd: string): string[];
```

Wiring in `McpManager.tools()` invoker (pseudocode):

```ts
adaptMcpTool(name, tool, async (invocation, ctx) => {
  const files = ctx?.onFilesChanged ? trackedGraphFiles(ctx.cwd) : [];
  const before = files.length ? snapshotFiles(ctx.cwd, files) : undefined;
  const content = await server.client.callTool(invocation.tool, invocation.arguments);
  if (before) {
    const changed = diffSnapshots(before, snapshotFiles(ctx.cwd, files));
    if (changed.length) ctx.onFilesChanged!(changed);
  }
  return { content };
});
```

No `cwd`/graph present → `files` is empty → zero overhead. The existing debounced
maintainer + `updateGraphForFiles` no-op handle the rest.

## Edge cases & risks

- **No graph** → `trackedGraphFiles` empty → snapshot is skipped entirely. Free.
- **Large graphs** → snapshot cost ∝ file count; `stat` is cheap, but consider a
  cap or only snapshotting after tools likely to mutate (hard to know — keep it
  simple, measure first).
- **New files** (created by the MCP tool) → not caught in v1 by design. Document
  it; Option B or C closes it.
- **Deletions** → `diffSnapshots` should treat a vanished file as "changed" so
  `updateGraphForFiles` can prune it (it already removes nodes for missing files).
- **Concurrent built-in + MCP edits** → both funnel into the same debounced
  maintainer; idempotent re-extraction makes this safe.
- **Paths outside `cwd`** → ignored by `updateGraphForFiles` (it only matches the
  graph's files). Fine.
- **Performance regressions on every MCP call** → gate the snapshot on
  `ctx.onFilesChanged` being present *and* a graph existing, so non-graph users
  pay nothing.

## Testing strategy

- Unit: `snapshotFiles` / `diffSnapshots` (modified, deleted, unchanged).
- Unit: `trackedGraphFiles` reads the stored graph's file set.
- Integration: extend the stdio fixture with a tool that writes/edits a file in a
  temp project that has a graph; assert the adapter reports the changed path and
  the graph reflects it (reuse `manager.test.ts` + a temp graph).
- Regression: a non-graph project triggers zero `updateGraphForFiles` work.

## Task breakdown (do later)

1. **[done] Thread `ctx` through the MCP adapter and invoker.**
   `adaptMcpTool` `execute(input, ctx)`; `McpToolInvoker` carries `ctx`;
   `McpManager.tools()` passes it. Tests: adapter forwards ctx; existing tool
   execution still works. Commit: `refactor: pass tool context into mcp adapter`.
2. **[done] Add `graph/fs-snapshot.ts` (snapshot/diff/trackedGraphFiles).**
   Unit-tested in isolation. Commit: `feat: add filesystem snapshot helpers for graph upkeep`.
3. **[done] Wire snapshot-diff into the MCP invoker.**
   After `callTool`, report changed tracked files via `ctx.onFilesChanged`.
   Integration test with a mutating fixture tool + temp graph. Commit:
   `feat: keep the graph fresh after mcp tools edit files`.
4. **(Optional, v2) Session filesystem watcher behind a flag.**
   Decide on `chokidar` vs native; ignore globs; subsumes built-in reporting.
   Commit: `feat: optional filesystem watcher for graph maintenance`.
5. **(Optional, v3) Per-server declarative path extraction.**
   Config schema + extraction; only for servers that document output. Commit:
   `feat: declarative changed-path extraction for mcp servers`.
6. **[done] Docs.** README "Knowledge graph → Maintain" now states MCP edits to
   tracked files keep the graph fresh (and notes the new-file gap). Commit:
   `docs: mcp tools now keep the graph fresh`.

## Open questions (decide before starting)

- Are we OK adding a watcher dependency (`chokidar`) for the general case, or do
  we stay snapshot-only and accept the "new files" gap?
- Should the snapshot be the graph's files only, or also a shallow scan of
  tracked directories to catch new files cheaply?
- Any MCP servers we care about enough to justify Option C path extraction?

# MCP Porting Study

## Goal

Port the MCP system concepts from `opencode-dev` into `lucky` without creating a runtime dependency on OpenCode, and keep the server catalog/discovery layer separate from the execution layer.

## What OpenCode Actually Has

OpenCode's MCP implementation is not a thin wrapper. It is a fairly complete subsystem with four distinct concerns:

1. `config`
   - config schema for local and remote MCP servers
   - per-server timeout, headers, env, enabled flag
   - optional OAuth config for remote servers

2. `runtime / lifecycle`
   - start local stdio servers
   - connect to remote HTTP/SSE servers
   - cache connected clients and their tool definitions
   - reconnect / disconnect / cleanup child processes
   - watch `tools/list_changed` notifications

3. `auth`
   - OAuth discovery / client registration flow
   - callback server
   - token persistence
   - auth status and re-auth flows

4. `product surface`
   - CLI commands: `mcp list`, `mcp auth`, `mcp logout`, `mcp add`
   - TUI dialogs
   - docs for config and usage

The center of gravity is:

- `packages/opencode/src/mcp/index.ts`
- `packages/opencode/src/config/mcp.ts`
- `packages/core/src/config/mcp.ts`

## The Pieces Worth Porting

These concepts map cleanly to `lucky` and are worth reusing at the architectural level:

1. A typed server config with two transport classes:
   - `local` via stdio
   - `remote` via HTTP/SSE

2. A runtime service that owns:
   - active clients
   - connection status
   - tool definition cache
   - prompts/resources access

3. A conversion layer from MCP tool definitions to Lucky tools.

4. A clean separation between:
   - server metadata/discovery
   - actual connection/execution

## The Pieces We Should Not Copy 1:1

Some OpenCode choices are valid there but should not drive Lucky's design:

1. Their Effect-based service graph.
   - `lucky` is much simpler and not built around `effect`.
   - Porting behavior is fine; porting the service framework is unnecessary.

2. Their remote config coupling through `/.well-known/opencode`.
   - Useful as one possible source of presets.
   - Not a good foundation for Lucky's ecosystem because it ties discovery to OpenCode's config format and hosting story.

3. Their MCP subsystem living half in `packages/core` and half in app/CLI code.
   - In Lucky, the runtime should stay in `packages/core`.
   - CLI should only provide commands/UI around that runtime.

## Lucky Today

Lucky already has the right insertion point:

- `packages/core/src/tools/types.ts`
- `packages/core/src/tools/registry.ts`
- `packages/core/src/tools/builtin/index.ts`
- `packages/cli/src/runtime.ts`

Right now, tools are local Zod-defined tools registered into a `ToolRegistry`.
That means MCP in Lucky does **not** need to change the agent loop or providers. It only needs to produce normal Lucky `Tool` objects and register them.

This is the key simplification versus OpenCode.

## Recommended Target Architecture

Keep MCP split into two layers.

### 1. MCP Runtime Layer

Lives in `packages/core/src/mcp/*`.

Responsibilities:

- parse Lucky MCP config
- start/connect servers
- list tools
- expose status
- optionally expose prompts/resources
- convert each remote MCP tool into a Lucky `Tool`
- register/unregister those tools in a `ToolRegistry`

Suggested modules:

- `mcp/types.ts`
- `mcp/config.ts`
- `mcp/client.ts`
- `mcp/manager.ts`
- `mcp/tool-adapter.ts`
- `mcp/auth.ts` later

### 2. MCP Catalog Layer

Lives separately from runtime, for example:

- `packages/core/src/mcp-catalog/*`

Responsibilities:

- search available MCP servers
- fetch metadata/presets/install snippets
- normalize results from external catalogs
- never own live client connections

Suggested interface:

- `CatalogSource.search(query)`
- `CatalogSource.get(id)`
- `CatalogEntry -> LuckyMcpPreset`

This avoids the trap of making the runtime depend on whichever catalog is fashionable today.

## External Catalog Strategy

Use an external catalog as a metadata source, not as a control plane.

Recommended order:

1. **Official MCP Registry** as the canonical source of server identity/metadata.
   - It is explicitly positioned as the official centralized metadata repository.
   - It exposes a REST API for aggregators.
   - Host applications are expected to consume downstream registries or marketplaces, not bind directly to the official registry UX.
2. **Secondary community catalogs** only for enrichment:
   - examples
   - popularity
   - tags
   - install snippets
   - **Glama** is useful here because it states that it ingests the official registry and layers tool-level analysis, schema capture, scoring, and drift history on top.
   - **Smithery** is useful if we want optional hosted connectivity or a richer managed integration story, but it is more than a catalog and should stay optional.
3. **Lucky curated presets** for the subset we want to support well.

That gives us:

- stable execution model in Lucky
- swappable discovery backends
- a curated UX when needed

## Why Not Depend on OpenCode's Hosted Config

Using OpenCode's `/.well-known/opencode` as the ecosystem base would create the wrong dependency direction:

1. Lucky would inherit OpenCode's config contract.
2. Discovery and runtime presets would be coupled.
3. Any OpenCode schema or hosting change becomes our problem.
4. We would still need our own normalization layer later.

That path saves very little and creates migration cost.

## Proposed Phased Port

### Phase 1

Implement the runtime only, no catalog UX yet.

Scope:

- local stdio servers
- remote HTTP/SSE servers without OAuth
- MCP tool discovery
- MCP tool -> Lucky `Tool` adapter
- registration into `ToolRegistry`
- basic status reporting

This is enough to prove the architecture.

### Phase 2

Add catalog support.

Scope:

- generic `CatalogSource` abstraction
- official-registry adapter
- local cached presets
- CLI command to search/add presets

### Phase 3

Add auth and richer MCP features.

Scope:

- OAuth for remote servers
- token persistence in `~/.luckycli/config.json` or a dedicated auth store
- prompts/resources support
- enable/disable and reconnect flows

## Practical Integration in Lucky

The least invasive path is:

1. Build an `McpManager` in core.
2. On agent construction, load configured MCP servers.
3. Ask the manager for adapted Lucky tools.
4. Register them into the same `ToolRegistry` as built-in tools.

That preserves:

- provider neutrality
- existing tool approval flow
- existing agent loop
- existing provider tool-schema generation

## Recommended Decision

Do **not** port OpenCode's MCP subsystem as a package-level dependency or as a schema dependency.

Do:

1. port the runtime concepts
2. keep catalog/discovery as a separate subsystem
3. use an external MCP catalog only as a source of metadata/presets
4. keep Lucky's execution contract fully internal

## First Build Order

1. add Lucky MCP config types
2. add MCP manager with local stdio support
3. adapt MCP tools into Lucky tools
4. inject those tools into `defaultToolRegistry()` or a new composed runtime registry
5. add remote HTTP/SSE support
6. only after that add catalog search/install UX

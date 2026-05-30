# lucky

A modern, multi-provider terminal AI agent. Built in TypeScript, designed so the
agent logic, tools and CLI never know which model provider is behind them.

> Status: **early scaffold.** The architecture is complete and type-safe.
> Anthropic and OpenAI (and therefore Ollama) adapters are fleshed out; the
> Gemini adapter is structurally complete but not yet exercised against the live
> API. Not all paths are tested end to end yet — see the roadmap.

## Architecture

Everything speaks one **canonical message format** (`packages/core/src/providers/types.ts`). Each
provider is just an *adapter* that translates that format to and from its own
wire protocol. Nothing outside `packages/core/src/providers/impl/` imports a
provider SDK.

```
┌────────────┐     AgentEvent      ┌──────────────┐
│  CLI / REPL │ ◀──────────────────│    Agent     │   the loop
└────────────┘                     │  (agent/)    │
                                   └──────┬───────┘
              canonical ChatRequest /     │       ToolRegistry
              StreamEvent                 │       (tools/)
                                   ┌──────▼───────┐  ┌──────────────┐
                                   │  Provider    │  │   Tools      │
                                   │  (providers/)│  │  read_file   │
                                   │  anthropic   │  │  write_file  │
                                   │  openai      │  │  exec        │
                                   │  gemini      │  └──────────────┘
                                   │  ollama      │
                                   └──────────────┘
```

### Layers

| Layer        | Path             | Responsibility                                           |
|--------------|------------------|----------------------------------------------------------|
| Core types   | `packages/core/src/providers` | Provider-agnostic messages, content blocks, stream events |
| Providers    | `packages/core/src/providers` | One adapter per provider; canonical ⇄ SDK translation     |
| Tools        | `packages/core/src/tools`     | Zod-typed tools + registry (JSON Schema generation)       |
| Agent        | `packages/core/src/agent`     | The provider ⇄ tool loop; owns conversation history       |
| Config       | `packages/core/src/config`    | Resolves provider/model from flags, env, defaults         |
| CLI          | `packages/cli/src`            | Interactive REPL + terminal rendering                     |

### Why this shape scales

- **Add a provider** = one adapter file + one line in `providers/registry.ts`.
- **Add a tool** = one file with a zod schema + `register()`.
- The agent loop is pure orchestration; it has no provider-specific code.
- Streaming is normalized to a tiny event vocabulary, so the CLI is trivial and
  a future web/TUI front-end can consume the same events.
- The package exports a library API (`src/index.ts`), so `lucky` can be embedded
  as well as run as a CLI.

## Setup

```bash
npm install
cp .env.example .env   # add your API keys
npm run dev            # run the REPL with tsx
```

CLI flags:

```bash
lucky --provider openai --model gpt-4o
lucky -p claude -m claude-sonnet-4-6
lucky -p ollama -m llama3.1
```

## Roadmap

- [ ] Verify Gemini adapter against the live API + surface finish reasons
- [ ] Conversation persistence / session resume
- [ ] Streaming markdown rendering in the CLI
- [x] Tool approval prompts for side-effecting tools (`exec`, `write_file`)
- [ ] Retry/backoff + structured error taxonomy in providers
- [ ] More tools (e.g. search)
- [ ] Unit tests per adapter with recorded fixtures
```

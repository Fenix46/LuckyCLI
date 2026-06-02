<h1 align="center">LuckyCLI</h1>

<p align="center">
  <img src="assets/mascot.png" alt="LuckyCLI mascot — a lucky black cat hugging a terminal" width="200">
</p>

<p align="center">
  A modern, multi-provider terminal AI agent. Built in TypeScript, designed so
  the agent logic, tools and CLI never know which model provider is behind them.
</p>

> Status: **working MVP.** The architecture is complete and type-safe, the build
> and unit suite are green, and the Ink-based REPL is interactive. Five provider
> adapters are implemented — Claude, OpenAI (API key + browser OAuth), Gemini
> (API key + Google OAuth via Code Assist) and Ollama. The agent loop runs tools,
> prompts for approval on side-effecting ones, and compacts context automatically.
>
> Caveat: adapters are covered by unit tests with mocked transports — there are
> **no recorded fixtures or end-to-end runs against the live APIs yet**. See the
> roadmap.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/Fenix46/LuckyCLI/main/install.sh | bash
```

This downloads the prebuilt `lucky` binary for your platform (macOS and Linux,
Intel or ARM) into `~/.local/bin` — no Node.js required. Then run:

```bash
lucky
```

Options: set `LUCKY_INSTALL_DIR` to install elsewhere, or `LUCKY_VERSION=v0.1.0`
to pin a version. On Windows, download `lucky-windows-x64.exe` from the
[releases page](https://github.com/Fenix46/LuckyCLI/releases).

### From source

```bash
git clone https://github.com/Fenix46/LuckyCLI.git && cd LuckyCLI
npm install && npm run build
npm link --workspace @luckycli/cli   # exposes `lucky` globally
```

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
                                   │  claude      │  │  write_file  │
                                   │  openai      │  │  edit_file   │
                                   │  openai-oauth│  │  list_dir    │
                                   │  gemini      │  │  glob / grep │
                                   │  ollama      │  │  exec        │
                                   └──────────────┘  │  http_fetch  │
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

On first run the REPL walks you through an interactive setup (theme, provider
choice, credentials, including browser OAuth for OpenAI and Google OAuth for
Gemini) and persists it to `~/.luckycli/config.json`. Defaults can also come from `.env`
(`LUCKY_PROVIDER`, `LUCKY_MODEL`) or be overridden with CLI flags:

```bash
lucky --provider openai --model gpt-4o
lucky -p claude -m claude-sonnet-4-6
lucky -p ollama -m llama3.1
```

Inside the REPL, slash commands drive the session:

```
/help      show all slash commands       /compact   summarize older history now
/model     switch model for the provider /provider  switch provider / login
/status    show provider and context      /theme     choose terminal UI colors
/resume    pick a saved session           /update    check for a newer release
/exit      quit (alias: /quit)
```

Side-effecting tools (`write_file`, `edit_file`, `exec`, `http_fetch`) prompt for
approval before running. When the conversation approaches the model's usable
context, the agent automatically summarizes the older turns to stay within budget.

### Sessions

Conversations are saved to `~/.luckycli/sessions/<id>.json` after each turn and
can be resumed:

```bash
lucky --continue        # resume the most recent session
lucky --resume          # pick a session to resume interactively
lucky --resume <id>     # resume a specific session
lucky --sessions        # list saved sessions and exit
```

A resumed session restores the transcript and the model's context, and keeps its
own provider/model unless you override them with flags.

## Testing

```bash
npm run typecheck   # tsc --build across the workspace
npm test            # vitest — unit suite for providers, agent and tools
```

Adapters are unit-tested with mocked transports; the suite does not yet hit live
provider APIs.

## Roadmap

- [x] Tool approval prompts for side-effecting tools (`exec`, `write_file`, `http_fetch`)
- [x] Automatic context compaction (summarize older turns near the budget)
- [x] Interactive model/provider switching from the REPL
- [x] Browser OAuth (OpenAI) and Google OAuth via Code Assist (Gemini)
- [x] Surgical file edits (`edit_file`) with fuzzy snippet matching
- [x] Code search tools (`glob`, `grep`)
- [x] Conversation persistence / session resume
- [ ] Verify adapters against the live APIs with recorded fixtures
- [ ] Streaming markdown rendering in the CLI
- [ ] Retry/backoff + structured error taxonomy in providers
```

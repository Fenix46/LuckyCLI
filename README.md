<h1 align="center">LuckyCLI</h1>

<p align="center">
  <img src="assets/mascot.png" alt="LuckyCLI mascot — a lucky black cat hugging a terminal" width="200">
</p>

<p align="center">
  A modern, multi-provider terminal AI coding agent. Built in TypeScript, designed so
  the agent loop, tools and CLI never know which model provider is behind them.
</p>

<p align="center">
  <code>claude</code> · <code>chatgpt</code> · <code>gemini</code> · <code>antigravity</code> · <code>openai</code> · <code>ollama</code>
</p>

---

LuckyCLI is an interactive REPL that drives a tool-using agent from your terminal.
It reads and edits files, runs shell commands, searches your codebase and fetches
docs — asking for approval before anything side-effecting — and works across six
model providers behind a single canonical message format. Switch provider or
model mid-session without losing your conversation.

> **Status:** working, actively used. The architecture is complete and type-safe,
> the build and unit suite are green, the Ink REPL is interactive, and several
> providers are verified against their live APIs (see [Provider support](#provider-support)).

## Highlights

- **Six providers, one core.** Claude, ChatGPT (OpenAI OAuth), Gemini, Antigravity,
  OpenAI (API key) and Ollama — all behind the same adapter interface.
- **Real auth, not just keys.** Browser OAuth for Claude, ChatGPT, Gemini and
  Antigravity; API keys for Claude/OpenAI/Gemini; Vertex AI for Gemini; local
  daemon for Ollama.
- **A genuine agent loop** that runs tools, streams output, and keeps going until
  the task is done (no fixed step cap) or you press `Esc`.
- **Safety built in.** Side-effecting tools prompt for approval, the shell tool
  refuses destructive commands, file tools are sandboxed to the working
  directory, and `http_fetch` blocks private/SSRF targets.
- **Remembered approvals.** Approve "always" once and LuckyCLI stops re-asking —
  per command for the shell, per tool for file writes — for the rest of the session.
- **Automatic context compaction.** Older turns are summarized as you approach the
  model's usable context, so long sessions don't fall over.
- **Persistent sessions.** Every turn is saved; resume the latest or pick from a list.
- **Embeddable.** The engine ships as a library (`@luckycli/core`) with a small,
  documented API — the CLI is just one front-end.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/Fenix46/LuckyCLI/main/install.sh | bash
```

This downloads the prebuilt `lucky` binary for your platform (macOS and Linux,
Intel or ARM) into `~/.local/bin` — no Node.js required. Then run:

```bash
lucky
```

Options: set `LUCKY_INSTALL_DIR` to install elsewhere, or `LUCKY_VERSION=v0.1.6`
to pin a version. On Windows, download `lucky-windows-x64.exe` from the
[releases page](https://github.com/Fenix46/LuckyCLI/releases).

### From source

Requires Node.js ≥ 20.

```bash
git clone https://github.com/Fenix46/LuckyCLI.git && cd LuckyCLI
npm install && npm run build
npm link --workspace @luckycli/cli   # exposes `lucky` globally
```

Or run it straight from the repo without linking:

```bash
npm run dev   # runs the REPL with tsx
```

## Quick start

On first run, LuckyCLI walks you through an interactive setup — pick a theme, a
provider, an auth method (including browser OAuth), and a model — then remembers
your choice in `~/.luckycli/config.json`. No `.env` required.

```bash
lucky                                   # interactive: pick provider + model
lucky -p claude -m claude-sonnet-4-6    # Claude
lucky -p openai-oauth -m gpt-5.5        # ChatGPT (browser login)
lucky -p gemini -m gemini-2.5-pro       # Gemini
lucky -p ollama -m llama3.1             # local model via Ollama
```

### CLI flags

| Flag | Description |
|------|-------------|
| `-p, --provider` | `claude` · `openai` · `openai-oauth` · `gemini` · `antigravity` · `ollama` |
| `-m, --model` | Model id (provider-specific; see [Models](#models)) |
| `-c, --continue` | Resume the most recent session |
| `--resume [id]` | Resume a session; with no id, pick one interactively |
| `--sessions` | List saved sessions and exit |
| `--setup` | Force the provider/auth switcher |
| `-h, --help` | Show help |

## Provider support

Each provider exposes one or more authentication methods. The methods below
marked **✅ Verified** have been exercised end-to-end against the live service;
the others are implemented and unit-tested with mocked transports.

| Provider | Display name | Auth methods | Status |
|----------|--------------|--------------|--------|
| `openai-oauth` | ChatGPT | Browser OAuth (ChatGPT Plus/Pro) | ✅ Verified |
| `claude` | Anthropic Claude | Browser OAuth (Pro/Max/Team/Enterprise) | ✅ Verified |
| `claude` | Anthropic Claude | API key (`ANTHROPIC_API_KEY`) | Implemented |
| `gemini` | Google Gemini | Browser OAuth (personal Google account) | ✅ Verified |
| `gemini` | Google Gemini | API key (Google AI Studio) | ✅ Verified |
| `gemini` | Google Gemini | Vertex AI (GCP project) | Implemented |
| `antigravity` | Google Antigravity | Browser OAuth | ✅ Verified |
| `openai` | OpenAI | API key (`OPENAI_API_KEY`, custom `OPENAI_BASE_URL`) | Implemented |
| `ollama` | Ollama (local) | Local daemon base URL | Implemented |

> OAuth logins open a browser window, complete the login on the provider's site,
> and capture the callback locally. Tokens are stored in `~/.luckycli/config.json`
> (written `0600`) and refreshed automatically when they expire.

### Models

Defaults in **bold**. Use `/model` in the REPL or `-m` on the CLI to switch.

- **ChatGPT** (`openai-oauth`): **gpt-5.5**, gpt-5.4, gpt-5.4-mini, gpt-5.3-codex, gpt-4o
- **Claude** (`claude`): claude-opus-4-8, **claude-sonnet-4-6**, claude-haiku-4-5
- **Gemini** (`gemini`): gemini-3.1-pro-preview, gemini-3.1-flash-lite, gemini-3-pro-preview, gemini-3-flash-preview, **gemini-2.5-pro**, gemini-2.5-flash, gemma-4-31b-it, gemma-4-26b-a4b-it
- **Antigravity** (`antigravity`): **gemini-3.5-flash-low**, gemini-3-flash-agent, gemini-3.1-pro-low, gemini-pro-agent, gemini-2.5-pro/flash, claude-sonnet-4-6, claude-opus-4-6-thinking, gpt-oss-120b-medium, …
- **OpenAI** (`openai`): **gpt-4o**, gpt-4o-mini, gpt-4.1, o4-mini
- **Ollama** (`ollama`): **llama3.1**, qwen2.5, mistral, gemma2 (any model you have pulled locally)

## The REPL

Type a message and press Enter. The agent streams its reasoning and tool calls
inline, asks for approval on side-effecting tools, and saves the session after
each turn.

### Keys

| Key | Action |
|-----|--------|
| `Enter` | Send the message |
| `Option/Alt + Enter` (macOS) · `Ctrl + Enter` (Win/Linux) | Insert a newline (multiline input) |
| `Esc` | Interrupt the running turn |
| `Ctrl + C` | Cancel a running turn, or quit when idle |
| `↑` / `↓` | Navigate menus and pickers |
| `Tab` | Complete the highlighted slash command |

### Slash commands

| Command | Description |
|---------|-------------|
| `/model` | Switch model for the active provider |
| `/provider` | Switch provider and authenticate |
| `/status` | Show provider auth, account, quota and context status |
| `/compact` | Summarize older chat history now |
| `/resume` | Pick a saved session to resume |
| `/theme` | Choose terminal UI colors |
| `/update` | Check for a newer LuckyCLI release |
| `/exit` | Quit (alias: `/quit`) |

## Tools

The agent is equipped with a registry of Zod-typed tools (JSON Schema is
generated automatically for each provider). Read-only tools run without asking;
side-effecting ones prompt for approval.

| Tool | Permission | What it does |
|------|------------|--------------|
| `read_file` | allow | Read a text file (relative to the working directory) |
| `list_dir` | allow | List files and directories at a path |
| `glob` | allow | Find files by name with a glob (e.g. `src/**/*.tsx`) |
| `grep` | allow | Search file contents with a regular expression |
| `http_fetch` | allow | Fetch the text content of a public URL |
| `todo_write` | allow | Maintain a session todo list for multi-step work |
| `ask_user` | allow | Ask you a clarifying question and wait for the answer |
| `write_file` | ask | Write UTF-8 text to a file |
| `edit_file` | ask | Replace an exact snippet in a file (fuzzy snippet matching) |
| `apply_patch` | ask | Apply a unified-diff patch to text files |
| `exec` | ask | Run a shell command and return its combined output |

### Safety model

- **Approval prompts.** Tools resolved to `ask` pause for `Allow once` / `Allow
  always` / `Reject`. Choosing **always** is remembered for the session — per
  exact command for `exec`, per tool for file writes — so you aren't re-prompted.
- **Filesystem sandbox.** File tools reject absolute paths and anything that
  escapes the working directory.
- **Destructive-command guard.** `exec` classifies commands and refuses clearly
  destructive ones (`rm -rf`, `sudo`, `mkfs`, `dd of=/dev/…`, `git reset --hard`,
  force pushes, …) unless explicitly allowed.
- **SSRF guard.** `http_fetch` allows only `http`/`https` and blocks `localhost`,
  cloud metadata endpoints, and private/loopback IP ranges (after DNS resolution).

Permissions are fully configurable — see [`LUCKY_TOOL_PERMISSIONS`](#configuration).

## Sessions

Conversations are saved to `~/.luckycli/sessions/<id>.json` after every turn.

```bash
lucky --continue        # resume the most recent session
lucky --resume          # pick a session to resume interactively
lucky --resume <id>     # resume a specific session
lucky --sessions        # list saved sessions and exit
```

A resumed session restores the transcript and the model's context, and keeps its
own provider/model unless you override them with flags.

## Context compaction

When the conversation approaches the model's usable context (default: 75% of the
budget, reserving room for output), the agent automatically summarizes the older
turns into a compact synopsis and continues — keeping recent turns verbatim. You
can also trigger it manually with `/compact`. Compaction is on by default and
tunable via `AgentConfig.compaction` when embedding the library.

## Configuration

Configuration is resolved in order of precedence: **CLI flags → stored config
(`~/.luckycli/config.json`) → environment variables → built-in defaults.** Nothing
throws for missing credentials — the REPL shows setup instead.

### Environment variables

Copy `.env.example` to `.env` to set any of these (the CLI loads `.env` on start).

**Defaults & behavior**

| Variable | Purpose |
|----------|---------|
| `LUCKY_PROVIDER` | Default provider when not passed via `-p` |
| `LUCKY_MODEL` | Default model when not passed via `-m` |
| `LUCKY_TEMPERATURE` | Sampling temperature |
| `LUCKY_MAX_TOKENS` | Max output tokens |
| `LUCKY_SYSTEM` | Replace the entire system prompt |
| `LUCKY_PROMPT_IDENTITY` / `_AGENCY` / `_TOOL_USE` / `_ENVIRONMENT` / `_SUMMARIZATION` | Override individual system-prompt sections |
| `LUCKY_TOOL_PERMISSIONS` | Permission overrides, e.g. `exec=deny,apply_patch=allow,mcp_*=ask` |
| `LUCKY_DISABLE_UPDATE_CHECK` | Skip the background update check |

**Provider credentials (env fallback / non-interactive)**

| Variable | Provider |
|----------|----------|
| `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` (+ `ANTHROPIC_REFRESH_TOKEN`) | Claude |
| `OPENAI_API_KEY` (+ optional `OPENAI_BASE_URL`) | OpenAI |
| `GEMINI_API_KEY` | Gemini (API key) |
| `GOOGLE_CLOUD_PROJECT` / `GOOGLE_CLOUD_LOCATION` / `GOOGLE_APPLICATION_CREDENTIALS` | Gemini (Vertex AI) |
| `ANTIGRAVITY_ACCESS_TOKEN` / `ANTIGRAVITY_REFRESH_TOKEN` / `ANTIGRAVITY_EXPIRES_AT` | Antigravity |
| `OLLAMA_BASE_URL` | Ollama (default `http://localhost:11434`) |

**Build-time OAuth clients** (compiled into release binaries via the build script;
keep secrets local, never commit real values):
`LUCKY_GOOGLE_OAUTH_CLIENT_ID` / `_SECRET`, `LUCKY_ANTIGRAVITY_OAUTH_CLIENT_ID` / `_SECRET`.

### Tool permission policy

The default policy allows read-only tools, asks for `write_file` / `edit_file` /
`apply_patch` / `exec`, and asks for any unknown tool. Override per tool or with
wildcard patterns (longest match wins):

```bash
# Deny shell execution, always allow patch edits, ask for any mcp_* tool
LUCKY_TOOL_PERMISSIONS=exec=deny,apply_patch=allow,mcp_*=ask
```

Stored config (`~/.luckycli/config.json` → `permissions`) is layered between the
defaults and the env override.

## Architecture

Everything speaks one **canonical message format**
(`packages/core/src/providers/types.ts`). Each provider is just an *adapter* that
translates that format to and from its own wire protocol. Nothing outside
`packages/core/src/providers/impl/` imports a provider SDK.

```
┌─────────────┐     AgentEvent      ┌──────────────┐
│  CLI / REPL  │ ◀──────────────────│    Agent     │   the loop
└─────────────┘                     │  (agent/)    │
                canonical request /  └──────┬───────┘
                stream events               │       ToolRegistry
                                     ┌──────▼───────┐  ┌──────────────┐
                                     │  Provider    │  │   Tools      │
                                     │  (providers/)│  │  read_file   │
                                     │  claude      │  │  write_file  │
                                     │  openai      │  │  edit_file   │
                                     │  openai-oauth│  │  apply_patch │
                                     │  gemini      │  │  glob / grep │
                                     │  antigravity │  │  exec        │
                                     │  ollama      │  │  http_fetch  │
                                     └──────────────┘  └──────────────┘
```

### Layers

| Layer | Path | Responsibility |
|-------|------|----------------|
| Core types | `packages/core/src/providers` | Provider-agnostic messages, content blocks, stream events |
| Providers | `packages/core/src/providers/impl` | One adapter per provider; canonical ⇄ SDK translation |
| Tools | `packages/core/src/tools` | Zod-typed tools + registry (JSON Schema generation) + permissions |
| Agent | `packages/core/src/agent` | The provider ⇄ tool loop; owns conversation history & compaction |
| Prompts | `packages/core/src/prompts` | Composable system prompt (identity/agency/tool-use/environment) |
| Config | `packages/core/src/config` | Resolves provider/model/credentials from flags, env, defaults; on-disk store |
| Sessions | `packages/core/src/session` | Flat-file persistence + resume |
| CLI | `packages/cli/src` | Interactive Ink REPL + terminal rendering |

### Why this shape scales

- **Add a provider** = one adapter file + one factory line in `providers/index.ts`.
- **Add a tool** = one file with a Zod schema + `register()`.
- The agent loop is pure orchestration; it has no provider-specific code.
- Streaming is normalized to a tiny event vocabulary, so the CLI is trivial and a
  future web/TUI front-end can consume the same events.

## Using the engine as a library

`@luckycli/core` exports the agent, tools, providers, config and session APIs so
you can embed LuckyCLI in your own tool.

```ts
import { Agent, defaultToolRegistry, getProvider, resolveConfig } from "@luckycli/core";

const config = resolveConfig({ provider: "claude", model: "claude-sonnet-4-6" });
const provider = getProvider(config.provider!, config.credentials!);

const agent = new Agent({
  provider,
  model: config.model!,
  tools: defaultToolRegistry(),
  system: config.system,
  permissions: config.permissions,
});

for await (const event of agent.send("List the TypeScript files in src/")) {
  if (event.type === "text") process.stdout.write(event.delta);
}
```

## Development

```bash
npm install
npm run build       # tsc --build across the workspace
npm run dev         # run the REPL with tsx (no build step)
npm run typecheck   # type-check the whole workspace
npm test            # vitest — unit suite for providers, agent and tools
```

The repo is an npm-workspaces monorepo: `@luckycli/core` (engine) and
`@luckycli/cli` (the `lucky` binary). Release binaries are built with Bun via
`scripts/build.ts`.

## Contributing

Contributions are welcome — bug fixes, new tools, provider adapters, docs.

1. **Fork & branch.** Create a feature branch off `main`.
2. **Keep the boundaries.** Provider SDKs are only imported inside
   `packages/core/src/providers/impl/`; everything else speaks the canonical
   format. Tools are self-contained files registered in
   `packages/core/src/tools/builtin/index.ts`.
3. **Stay green.** Run `npm run typecheck && npm test` before opening a PR. Add or
   update unit tests for the behavior you change (transports are mocked — no live
   API calls in the suite).
4. **Match the style.** Follow the surrounding code: small modules, explanatory
   comments where intent isn't obvious, no provider-specific code in the agent loop.
5. **Write a clear PR.** Describe what changed and why; note anything you tested
   manually (e.g. against a live provider).

Good first contributions:

- **A new tool** — add a Zod-typed file under `tools/builtin/`, register it, give
  it a sensible default permission.
- **A new provider adapter** — implement `IProvider`, add a catalog entry in
  `providers/catalog.ts`, and a factory in `providers/index.ts`.
- **Provider model lists** — keep `providers/catalog.ts` current as vendors ship models.

If you're planning something larger, open an issue first so we can align on the
approach.

## Roadmap

- [x] Tool approval prompts for side-effecting tools (`exec`, `write_file`, `apply_patch`, `http_fetch`)
- [x] Remembered "always" approvals (per-command for shell, per-tool for writes)
- [x] Automatic context compaction (summarize older turns near the budget)
- [x] Interactive model/provider switching from the REPL
- [x] Browser OAuth for Claude, ChatGPT, Gemini and Antigravity
- [x] Surgical file edits (`edit_file`) with fuzzy snippet matching + `apply_patch`
- [x] Code search tools (`glob`, `grep`)
- [x] Conversation persistence / session resume
- [x] Filesystem sandbox, destructive-command guard, and SSRF protection
- [ ] Recorded fixtures / end-to-end tests against the live APIs
- [ ] Streaming markdown rendering in the CLI
- [ ] Retry/backoff + structured error taxonomy across providers
- [ ] MCP tool support

## License

Apache-2.0.

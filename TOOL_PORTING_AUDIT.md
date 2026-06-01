# Tool porting audit: OpenCode + Claude Code -> LuckyCLI

Sorgenti analizzate:

- `/Users/emanuele/Downloads/opencode-dev`
- `/Users/emanuele/Downloads/claude-code-main`
- target: `LuckyCLI` (`packages/core/src/tools`)

## Stato attuale LuckyCLI

Tool built-in presenti:

| LuckyCLI | Stato | Note |
|---|---:|---|
| `read_file` | presente | lettura UTF-8 max 256KB, path sandboxed nel cwd |
| `write_file` | presente | scrittura/overwrite UTF-8, path sandboxed |
| `edit_file` | presente | replace robusto; logica già derivata da OpenCode |
| `exec` | presente | shell command con timeout/max buffer |
| `list_dir` | presente | elenco directory |
| `glob` | presente | glob custom, ignore dir comuni |
| `grep` | presente | regex scan custom, max match/file size |
| `http_fetch` | presente | fetch pubblico con protezioni SSRF |

## Tool OpenCode individuati

Registry OpenCode: `packages/opencode/src/tool/registry.ts`.

| OpenCode | Equivalente LuckyCLI | Portabilità | Priorità | Note |
|---|---|---:|---:|---|
| `read` | `read_file` | già coperto/parziale | P2 | OpenCode supporta range di righe; LuckyCLI no. |
| `write` | `write_file` | già coperto | P3 | OK. |
| `edit` | `edit_file` | già coperto bene | P3 | Lucky ha replace robusto da OpenCode. |
| `bash`/`shell` | `exec` | già coperto/parziale | P1 | Da portare: sicurezza comandi, warning distruttivi, migliore output. |
| `glob` | `glob` | già coperto/parziale | P2 | OpenCode usa ripgrep/glob più maturi e rispetta ignore. |
| `grep` | `grep` | già coperto/parziale | P2 | Migliorabile con ripgrep vero per performance e gitignore. |
| `webfetch` | `http_fetch` | già coperto/parziale | P1 | Da portare: conversione HTML/markdown, estrazione testo migliore. |
| `websearch` | assente | portabile | P1 | Serve ricerca web; OpenCode usa Exa/MCP/feature flags. |
| `question` | assente | portabile con UI CLI | P1 | Tool per chiedere chiarimenti all’utente durante il loop. |
| `todowrite` | assente | facile | P1 | Todo list in-session, molto utile per task multi-step. |
| `task` | assente | medio/alto | P2 | Sub-agent/task delegation. Richiede orchestration. |
| `lsp` | assente | medio/alto | P2 | Code intelligence: definition, refs, hover, symbols. |
| `patch`/`apply_patch` | assente | medio | P1 | Tool per applicare diff/patch in modo controllato. |
| `skill` | assente | facile/medio | P2 | Carica skill `SKILL.md`/istruzioni specializzate. |
| `repo_clone` | assente | facile/medio | P2 | Clone repo in workspace controllato. |
| `repo_overview` | assente | medio | P2 | Sommario repo/deps/struttura. |
| `plan`/`plan_exit` | assente | facile | P2 | Modalità pianificazione prima di edit. |
| plugin custom tools | assente | medio | P2 | OpenCode carica `{tool,tools}/*.{js,ts}` e plugin. |
| MCP tools | assente nel core toolset | medio/alto | P1/P2 | Integrazione server MCP per tool esterni. |

## Tool Claude Code individuati

Registry principale: `src/tools.ts` e `src/constants/tools.ts`.

| Claude Code | Equivalente LuckyCLI | Portabilità | Priorità | Note |
|---|---|---:|---:|---|
| `BashTool` | `exec` | già coperto/parziale | P1 | Molte parti utili: command semantics, destructive warning, read-only validation, sandbox. |
| `PowerShellTool` | assente | medio | P3 | Utile solo cross-platform Windows. |
| `FileReadTool` | `read_file` | già coperto/parziale | P2 | Claude ha limiti, immagini, notebook; portare line ranges e image metadata. |
| `FileWriteTool` | `write_file` | già coperto | P3 | Portare diff/permission UX se serve. |
| `FileEditTool` | `edit_file` | già coperto/parziale | P2 | Claude ha validazioni extra e diff UI. |
| `GlobTool` | `glob` | già coperto | P3 | OK. |
| `GrepTool` | `grep` | già coperto/parziale | P2 | Portare ripgrep/ugrep se desiderato. |
| `WebFetchTool` | `http_fetch` | già coperto/parziale | P1 | Portare markdown/readability e preapproval URL. |
| `WebSearchTool` | assente | portabile | P1 | Ricerca web. |
| `TodoWriteTool` | assente | facile | P1 | Quasi obbligatorio per agentic coding. |
| `AskUserQuestionTool` | assente | facile/medio | P1 | Richiede evento agente/UI per prompt interattivo. |
| `EnterPlanModeTool`/`ExitPlanModeTool` | assente | facile/medio | P2 | Implementabile come stato/modo. |
| `AgentTool` | assente | medio/alto | P2 | Sub-agenti con prompt specializzati. |
| `TaskCreate/Get/Update/List/Stop/Output` | assente | alto | P2/P3 | Sistema task asincrono; utile ma architetturale. |
| `SkillTool` | assente | facile/medio | P2 | Simile OpenCode skill. |
| `LSPTool` | assente | medio/alto | P2 | Definition/references/hover/symbols. |
| `MCPTool`, `ListMcpResourcesTool`, `ReadMcpResourceTool`, `McpAuthTool` | assente | medio/alto | P1/P2 | Importante per estensibilità. |
| `NotebookEditTool` | assente | medio | P3 | Jupyter-specific. |
| `BriefTool` | assente | medio | P3 | Allegati/brief; non core. |
| `ToolSearchTool` | assente | medio | P2 | Utile quando troppi tool/MCP: search/defer tools. |
| `EnterWorktreeTool`/`ExitWorktreeTool` | assente | medio | P2 | Isolamento modifiche via git worktree. |
| `ConfigTool` | assente | facile | P3 | Modifica setting da agente, potenzialmente rischioso. |
| `SleepTool` | assente | facile | P3 | Pausa/scheduling/proactive. |
| `Cron*`, remote trigger, notifications, team/swarm | assenti | alto | P3 | Non core per prima fase. |
| `REPLTool` | assente | alto | P3 | VM/REPL complesso. |
| `WebBrowserTool`, terminal capture, workflow, snip | assenti | alto | P3 | Feature avanzate/flagged. |

## Gap più importanti per LuckyCLI

### P1: da fare subito

1. `todo_write`
   - Tool stateful in sessione per gestire task: `{content,status,priority}`.
   - Basso rischio, alto impatto su qualità delle risposte.

2. `ask_user` / `question`
   - Permette al modello di chiedere chiarimenti invece di indovinare.
   - Richiede estendere `AgentEvent` o gestire nel tool via callback context.

3. `apply_patch`
   - Più sicuro/compatto per modifiche multi-file rispetto a write completo.
   - Utile per portare diff standard.

4. `web_search`
   - Complementare a `http_fetch`.
   - Opzioni: provider esterno (Tavily/Exa/SerpAPI) o MCP search.

5. hardening `exec`
   - Portare idee Claude/OpenCode: detect comandi distruttivi, git safety, timeout streaming, max output/truncation robusta, read-only mode.

6. migliorare `http_fetch`
   - Conversione HTML -> markdown/testo pulito.
   - Content-type handling, title, link metadata, size limits migliori.

7. MCP base
   - Importante per “iniettare” tool esterni senza portarli tutti a mano.

### P2: seconda ondata

1. `lsp`
   - Azioni minime: `definition`, `references`, `hover`, `document_symbols`, `workspace_symbols`.

2. `skill`
   - Loader di `SKILL.md` da `.lucky/skills`, repo, home config.

3. `agent`/`task` sub-agents
   - Delegazione: ricerca, verifica, planning.
   - Richiede controllo recursion/tool allowance.

4. custom tool loader
   - Stile OpenCode: caricare `.lucky/tool/*.ts|js` oppure config.

5. repo tools
   - `repo_overview`, eventuale `repo_clone`.

6. worktree mode
   - Creare branch/worktree isolati per modifiche rischiose.

7. tool permissions/config
   - allow/ask/deny per tool o wildcard, tipo OpenCode/Claude.

### P3: opzionali/avanzati

- Notebook edit.
- PowerShell dedicato.
- Cron/proactive tasks.
- Team/swarm tools.
- REPL/VM.
- Browser automation.
- Workflow scripts.

## Mapping nomi consigliato in LuckyCLI

Mantenere stile attuale snake_case descrittivo:

- `todo_write`
- `ask_user`
- `apply_patch`
- `web_search`
- `lsp`
- `skill`
- `subagent` oppure `task_agent`
- `repo_overview`
- `repo_clone`
- `enter_plan_mode`, `exit_plan_mode`
- `enter_worktree`, `exit_worktree`
- `mcp_list_tools`, `mcp_read_resource` oppure integrazione dinamica diretta nel registry

## Note architetturali

LuckyCLI oggi ha un `ToolContext` minimale:

```ts
interface ToolContext {
  cwd: string;
  signal?: AbortSignal;
}
```

Per portare i tool P1/P2 servirà probabilmente estenderlo con:

```ts
interface ToolContext {
  cwd: string;
  signal?: AbortSignal;
  sessionId?: string;
  askUser?: (question: AskUserRequest) => Promise<string>;
  state?: ToolSessionState;
  permissions?: ToolPermissionPolicy;
}
```

Oppure mantenere il context pulito e implementare tool stateful via factory:

```ts
export function createTodoWriteTool(store: TodoStore): Tool { ... }
```

## Piano implementativo breve

1. Aggiungere `todo_write` con test.
2. Aggiungere `apply_patch` con test su patch valida/invalid/path traversal.
3. Migliorare `http_fetch` con HTML-to-text/markdown leggero.
4. Aggiungere `web_search` con adapter opzionale e fallback informativo se manca API key.
5. Hardening `exec`: destructive command warning/metadata + output truncation coerente.
6. Disegnare `ask_user` modificando eventi UI/agent.
7. MCP base o custom tool loader.

## Attenzione licenze

Prima di copiare codice direttamente, verificare licenze dei repo sorgente. Per ridurre rischio: portare idee/API/design, riscrivere implementazioni compatibili con LuckyCLI, copiare solo se licenza e attribuzione lo consentono.

# Tool porting audit: Claude Code -> LuckyCLI

Sorgenti consultate:

- Claude Code: `/Users/emanuelescarlata/Downloads/claude-code-main`
- LuckyCLI target: `packages/core/src/tools`

Questo audit e' mirato alla prima ondata di porting dei tool piu' importanti.
Non propone di copiare codice: Claude Code va usato come riferimento di prodotto,
semantica e UX; le implementazioni vanno riscritte nello stile LuckyCLI.

## Stato attuale LuckyCLI

Tool built-in registrati in `packages/core/src/tools/builtin/index.ts`:

| LuckyCLI | Stato attuale | Valutazione |
|---|---|---|
| `read_file` | presente | Utile ma minimale: manca lettura per range di righe. |
| `write_file` | presente | Sufficiente per prima fase. |
| `edit_file` | presente | Buona base per replace mirati. |
| `apply_patch` | presente | Base utile, ma supporta solo patch su file esistenti. |
| `exec` | presente | Gia' ha warning distruttivi basilari; manca semantica shell piu' matura. |
| `list_dir` | presente | Sufficiente. |
| `glob` | presente | Funziona, ma e' custom; non e' maturo quanto ripgrep/bfs. |
| `grep` | presente | Funziona, ma e' custom; non sfrutta `rg`/gitignore. |
| `http_fetch` | presente | Gia' converte HTML in testo markdown-like e blocca URL privati. |
| `todo_write` | presente | Prima ondata gia' portata. |
| `ask_user` | presente | Prima ondata gia' portata con bridge TUI. |

Conclusione: il vecchio P1 (`todo_write`, `ask_user`, `apply_patch`,
`http_fetch`) e' in gran parte gia' coperto. Il vero gap iniziale ora e':
`web_search`, hardening dei tool filesystem/shell, MCP minimo, e miglioramenti
di qualita' su `read_file`/`grep`/`glob`.

## Claude Code: tool rilevanti

Registry principale:

- `src/tools.ts`
- `src/constants/tools.ts`

Claude Code distingue una base tool molto ampia, ma la parte che vale la pena
portare subito in LuckyCLI e' piu' piccola:

| Claude Code | LuckyCLI | Priorita' | Note di porting |
|---|---|---:|---|
| `WebSearchTool` | assente | P0 | Primo tool realmente mancante. Serve per domande temporali/docs/news senza affidarsi solo a URL noti. |
| `FileReadTool` | `read_file` | P0 | Portare `offset`/`limit` e output con numeri di riga. Alto impatto, basso rischio. |
| `BashTool` | `exec` | P0/P1 | Portare semantica comando, read-only validation e warning piu' precisi. Evitare copia. |
| `GrepTool` | `grep` | P1 | Preferire `rg` quando disponibile; fallback custom. Rispetta gitignore e scala meglio. |
| `GlobTool` | `glob` | P1 | Preferire `rg --files`/ignore reali quando disponibile; fallback custom. |
| `WebFetchTool` | `http_fetch` | P1 | Gia' coperto; migliorare metadata, content-type, link/title e size limits. |
| `MCPTool` / resources | assente | P1 | Estensibilita' piu' importante dei tool specialistici singoli. |
| `SkillTool` | assente | P2 | Utile, ma LuckyCLI non ha ancora un sistema skill locale proprio. |
| `EnterPlanMode` / `ExitPlanMode` | assente | P2 | Piu' modalita' UI/agent che tool puro. |
| `AgentTool` / task tools | assente | P2/P3 | Potente ma architetturale: sub-agent, recursion policy, memoria. |
| `LSPTool` | assente | P2/P3 | Utile per code intelligence, ma richiede client LSP e gestione server. |
| `NotebookEditTool` | assente | P3 | Specifico Jupyter, non core iniziale. |
| Worktree tools | assente | P3 | Utile per isolamento, ma non prima dei tool base. |

## Prima ondata consigliata

### 1. `read_file`: range di righe e output numerato

Motivo: e' il miglior rapporto impatto/complessita'. Claude Code spinge molto
sull'uso di letture parziali per non bruciare contesto.

Proposta API:

```ts
{
  path: string;
  offset?: number; // 1-based line number
  limit?: number;  // max lines
}
```

Comportamento:

- Se `offset`/`limit` mancano, comportamento attuale.
- Se presenti, ritorna solo quel range con prefisso `lineNumber: content`.
- Limite massimo righe ragionevole, ad esempio 2000.
- Mantiene limite byte per evitare file enormi.

### 2. `web_search`

Motivo: e' il primo tool fondamentale ancora assente. Claude Code ha un tool
dedicato e lo tratta come parte della base agentica.

Proposta pragmatica:

- Tool `web_search` con schema `{ query: string, maxResults?: number }`.
- Adapter provider opzionale via env:
  - `LUCKY_WEB_SEARCH_PROVIDER=tavily|exa|serpapi`
  - API key dedicata.
- Se manca config, ritorna errore istruttivo e non finge di cercare.
- Output compatto: titolo, URL, snippet, data se disponibile.

Nota: senza accesso rete/API configurata, non va implementato con scraping fragile
di search engine pubblici.

### 3. `exec`: hardening BashTool-inspired

LuckyCLI ha gia' `classifyDangerousCommand`, ma Claude Code ha una distinzione
piu' matura tra:

- comandi read-only;
- comandi potenzialmente mutanti;
- comandi distruttivi;
- git operations rischiose;
- permission UX e descrizione del comando.

Prima miglioria utile:

- aggiungere `classifyCommandSemantics(command)` con categorie:
  - `read_only`
  - `mutating`
  - `destructive`
  - `unknown`
- rendere piu' chiaro l'errore quando serve `allowDangerous`.
- allargare detection per `mv`, `cp`, redirect overwrite, `truncate`, `find -delete`,
  `npm install`, package manager mutanti, `git push --force`.

### 4. `grep` e `glob`: usare strumenti nativi quando disponibili

Claude Code evita di fare tutto a mano quando puo' usare search tools veloci.
LuckyCLI oggi cammina il filesystem custom.

Porting consigliato:

- `grep`: usa `rg --json` o `rg --line-number` se disponibile.
- `glob`: usa `rg --files` e filtra pattern, rispettando `.gitignore`.
- fallback ai tool custom attuali quando `rg` non c'e'.
- mantenere sandbox path in `cwd`.

### 5. MCP minimo

Claude Code ha MCP come estensibilita' core: `MCPTool`, `ListMcpResourcesTool`,
`ReadMcpResourceTool`, `McpAuthTool`.

Prima versione LuckyCLI:

- config MCP in `~/.luckycli/config.json` o `.lucky/mcp.json`;
- caricamento server stdio base;
- esposizione dinamica tool MCP nel registry;
- risorse: `mcp_list_resources`, `mcp_read_resource`;
- no auth complesso nella prima iterazione.

## Seconda ondata

1. `skill`
   - Loader locale di `SKILL.md`.
   - Percorsi: `.lucky/skills/*/SKILL.md` e `~/.luckycli/skills`.

2. plan mode
   - Meglio come stato agent/TUI prima che come tool puro.
   - Slash command o tool `enter_plan_mode` solo dopo aver definito UX.

3. sub-agent/task
   - Richiede policy anti-recursion, subset tool, memoria isolata e output summary.
   - Da rimandare finche' MCP/search/read/exec non sono solidi.

4. LSP
   - Utile ma costoso: server manager, lifecycle, formatter output.

## Cose da non portare subito

- Notebook edit.
- PowerShell dedicato.
- Cron/proactive tasks.
- Team/swarm.
- Browser automation.
- REPL/VM.
- Worktree mode.
- ConfigTool modificabile dal modello.

Sono feature valide, ma creano superficie, permessi e complessita' prima che i
tool fondamentali siano maturi.

## Roadmap implementativa breve

1. Migliorare `read_file` con `offset`/`limit` e test.
2. Aggiungere `web_search` con adapter configurabile e fallback chiaro.
3. Rafforzare `exec` con semantica comando e warning piu' robusti.
4. Migliorare `grep`/`glob` usando `rg` se disponibile.
5. Disegnare MCP stdio base e integrazione registry.
6. Solo dopo: `skill`, plan mode, sub-agent.

## Note licenza

Claude Code va usato come benchmark di comportamento e priorita'. Evitare copia
diretta di implementazioni, prompt lunghi o UI complete salvo verifica licenza e
attribuzione. Per LuckyCLI conviene riscrivere componenti piccoli e testati in
base agli stessi principi.

# LuckyCLI — porting & feature audit

Questo documento traccia cosa LuckyCLI ha portato e adattato da progetti di
riferimento, e a che punto sono i tool e le feature principali. Principio guida:
non si copia codice. I progetti di riferimento valgono come benchmark di
prodotto, semantica e UX; le implementazioni vengono **riscritte nello stile
LuckyCLI** (Node + zod + tipi canonici) e testate.

Riferimenti open source citati:

- [graphify](https://github.com/safishamsi/graphify) — motore del knowledge
  graph (pipeline detect → extract → build → query, schema nodi/archi).
- [opencode](https://github.com/sst/opencode) — idee per il fuzzy replace di
  `edit_file`.

## Tool built-in

Registrati in `packages/core/src/tools/builtin/index.ts`:

| Tool | Stato | Note |
|---|---|---|
| `read_file` | fatto | `offset`/`limit` e output numerato per range di righe. |
| `write_file` | fatto | `overwrite=false` per evitare sovrascritture accidentali. |
| `edit_file` | fatto | Replace mirati con fuzzy snippet matching. |
| `apply_patch` | fatto | Update/create/delete via unified diff standard, sempre sandboxed. |
| `exec` | fatto | Classifica `read_only`/`mutating`/`destructive` e blocca i comandi rischiosi. |
| `PowerShell` | fatto | Tool dedicato per Windows: esecuzione senza `cmd.exe`, UTF-8, exit code speciali, blocco distruttivi. |
| `list_dir` | fatto | Output ordinato (directory prima dei file), `limit`. |
| `glob` | fatto | Usa `rg --files` se disponibile, fallback custom. |
| `grep` | fatto | Usa `rg` se disponibile, fallback custom. |
| `http_fetch` | fatto | HTML → testo, blocco URL privati/SSRF. |
| `todo_write` | fatto | Lista todo di sessione per lavori multi-step. |
| `project_memory` | fatto | Aggiorna `.lucky/memory.md` per fatti stabili del progetto. |
| `graph_query` | fatto | Interroga il knowledge graph (find/callers/callees/neighbors/file). |
| `graph_overview` | fatto | Sintesi del grafo (conteggi, god node, moduli più importati). |
| `ask_user` | fatto | Domanda di chiarimento con bridge TUI. |

### Permission UX

- Approvazioni `always` ricordate allo scope giusto (per-comando su `exec`,
  per-tool su `write_file`/`edit_file`/`apply_patch`): niente re-prompt continuo.
- Modalità di sessione ciclabile con `Shift+Tab` (`normal` ↔ `accept edits`),
  indicatore nel footer; in `accept edits` i tool di scrittura sono
  auto-approvati, `exec` chiede comunque. Tornare a `normal` azzera le `always`.
- Policy default esplicita per ogni tool (read-only `allow`, scrittura/shell
  `ask`), con fallback `*` = `ask` per i tool futuri.

| Tool | Registry | Prompt tool-use | Policy default |
|---|---:|---:|---|
| `read_file` | sì | sì | allow |
| `write_file` | sì | sì | ask |
| `edit_file` | sì | sì | ask |
| `apply_patch` | sì | sì | ask |
| `exec` | sì | sì | ask |
| `PowerShell` | sì | sì | ask |
| `list_dir` | sì | sì | allow |
| `glob` | sì | sì | allow |
| `grep` | sì | sì | allow |
| `http_fetch` | sì | sì | allow |
| `todo_write` | sì | sì | allow |
| `project_memory` | sì | sì | ask |
| `graph_query` | sì | sì | allow |
| `graph_overview` | sì | sì | allow |
| `ask_user` | sì | sì | allow |

## Knowledge graph (portato da graphify)

Layer nativo che mappa il progetto in un grafo (file, simboli, import, call) usato
come cache di conoscenza: l'agente interroga il grafo invece di rileggere i file,
risparmiando token. Tutto nativo TypeScript, nessun servizio esterno; il grafo
vive in `.lucky/graph/graph.json`.

Pipeline (in `packages/core/src/graph/`), adattata dalle fasi di graphify
`detect → extract → build → query`:

- `types.ts` — schema zod nodi/archi (id, label, kind, sourceFile, sourceLocation
  / source, target, relation, confidence `EXTRACTED|INFERRED|AMBIGUOUS`) e
  validazione di integrità referenziale.
- `store.ts` — load/save/query su `.lucky/graph/`, validato in lettura e scrittura.
- `extract/` — parsing con **tree-sitter** (WASM, portabile in Node, nei test e
  nel binario standalone Bun via embedding dei `.wasm`); interfaccia `Extractor`
  comune. Estrattori: TypeScript/TSX/JavaScript e Python.
- `detect.ts` — walk del progetto + dispatch per linguaggio.
- `build.ts` — assemblaggio (node id idempotenti, drop degli archi con endpoint
  inesistenti) + comando `lucky graph build`.
- `query.ts` — traversal puri (callers/callees, neighbors, god node per grado,
  moduli più importati, overview), esposti dai tool `graph_query`/`graph_overview`.
- `update.ts` — aggiornamento incrementale: ri-estrae solo i file toccati. È
  agganciato ai tool di scrittura (`onFilesChanged`) e a un maintainer debounced
  nel runtime, quindi il grafo resta aggiornato **autonomamente** dopo le modifiche
  del modello.

Onboarding per-cartella: al primo accesso si chiede trust + build del grafo
(stato persistito per path; mai richiesto due volte). Per progetti già avviati:
`/graph` nella REPL o `lucky graph build`.

### Cosa è stato volutamente lasciato fuori di graphify

Portato solo il nucleo che dà il risparmio di token. Esclusi per ora (non servono
allo scopo, e aggiungerebbero superficie e dipendenze):

- community detection / clustering (Leiden), MinHash dedup, analisi avanzate;
- generazione wiki/Obsidian, export SVG/HTML, call-flow diagrams;
- server MCP, ingest di URL/PDF, transcription video;
- risoluzione simboli cross-file (per ora le `calls` sono intra-file);
- i ~25 linguaggi extra (si aggiungono uno alla volta dietro `Extractor`).

## Prossimo focus

1. MCP stdio minimo + risorse (estensibilità).
2. `web_search` con adapter configurabile via env e fallback chiaro (HOLD finché
   non si decide il provider).
3. Più linguaggi per il grafo (Go, Rust, Java, C/C++, …).
4. Risoluzione `calls` cross-file nel grafo.
5. Skill loader locale, plan mode, sub-agent — solo dopo aver stabilizzato MCP.
6. LSP per code intelligence (costoso: lifecycle server, output formatting).

## Cose da non portare subito

- Notebook edit, browser automation, REPL/VM, worktree mode.
- Cron/proactive tasks, team/swarm.
- ConfigTool modificabile dal modello.

Valide ma creano superficie/permessi prima che le fondamenta siano mature.

## Stato versione

- Base tool (14, inclusi i due tool grafo) completa e verificata.
- Permission UX e knowledge graph nativo completati.
- Prossimo lavoro strutturale: MCP, poi più linguaggi/risoluzione cross-file e
  skill/plan/sub-agent.

## Note licenza

I progetti di riferimento valgono come benchmark di comportamento e priorità.
Evitare copia diretta di implementazioni, prompt lunghi o UI complete senza
verifica di licenza e attribuzione. Per LuckyCLI conviene riscrivere componenti
piccoli e testati seguendo gli stessi principi.

# ACP Task List — collegare LuckyCLI agli editor

Branch di lavoro: `feat/acp` (base: `feat/graph-context-injection`)

Obiettivo: implementare l'**Agent Client Protocol** (ACP, lo standard di Zed —
JSON-RPC 2.0 su stdio) così che Zed, JetBrains, Neovim/Emacs e VS Code (via
estensioni ACP) possano lanciare `lucky acp` come sottoprocesso e usare LuckyCLI
come agente, con streaming, approvazioni, diff e piani nell'UI dell'editor.
Riferimenti: https://agentclientprotocol.com — SDK TypeScript ufficiale
`@zed-industries/agent-client-protocol` (Apache-2.0, come noi).

Decisioni architetturali già prese in fase di studio:

- **L'adapter vive in `packages/cli/src/acp/`**, non in core: è un frontend
  alternativo alla TUI, consuma le stesse astrazioni (`buildAgentRuntime`,
  `AgentEvent`, i bridge `approveTool`/`askUser`/`presentPlan`) che già vivono
  accanto ad esso in `runtime.ts`. Core resta senza dipendenza dall'SDK ACP.
- **Un processo = un client editor**, sessioni multiple per processo (mappa
  `sessionId → { agent, abort, runtime }`). Niente daemon condiviso in v1.
- **Auth fuori banda**: `initialize` non dichiara authMethods; se la config non
  ha credenziali si risponde con un errore chiaro ("run `lucky` once to log
  in"). Niente OAuth dentro l'editor in v1.
- La mappatura chiave è quasi 1:1 e va preservata nei commit:
  `agent.send()`/`AgentEvent` → `session/update`; bridge `approveTool` →
  `session/request_permission` (allow once/always/reject); `ToolResultMetadata`
  (diff) → tool_call content `diff`; `presentPlan`/task tools → `plan`;
  `permissionMode` → `session/set_mode`; session store → `session/load`.

Regola operativa per tutto questo lavoro (come per MCP):

- ogni task deve chiudersi con:
  - test eseguiti e verdi per lo scope del task
  - commit mirato, con prefisso convenzionale tipo `feat:`, `refactor:`,
    `test:`, `docs:`
- niente task "lunghi" che mischiano transport, sessioni, permessi e docs nello
  stesso commit
- niente merge su `main` finché non chiudiamo tutte le milestone concordate
- tutti i test ACP girano **offline**: client finto su stream in-memory,
  provider scriptato (riusare il pattern `ScriptedProvider` di
  `agent.test.ts`), mai API live

## Milestone 0 — Baseline e guardrail

### Task 0.1 — Mettere a terra il piano tecnico

Scope:

- consolidare studio e task list nel repo (questo file)
- fissare le decisioni architetturali sopra

Done when:

- la sequenza di implementazione è esplicita e condivisa

Test:

- nessun test runtime richiesto

Commit:

- `docs: add acp integration study and execution task list`

### Task 0.2 — Fotografare il baseline

Scope:

- eseguire `npm run build`, `npm run typecheck`, `npm test` sul branch
- registrare eventuali failure preesistenti

Done when:

- baseline verde documentata (o issue preesistenti annotate qui)

Test:

- `npm run build` · `npm run typecheck` · `npm test`

Commit:

- nessun commit se tutto verde

## Milestone 1 — Fondazioni: transport e handshake

### Task 1.1 — Dipendenza SDK e skeleton del server stdio

Scope:

- aggiungere `@zed-industries/agent-client-protocol` a `packages/cli`
- nuovo modulo `packages/cli/src/acp/server.ts`: costruzione della
  `AgentSideConnection` su stream iniettabili (stdio in produzione, duplex
  in-memory nei test)
- implementare `initialize`: negoziazione versione protocollo, capabilities
  (`loadSession: true`, prompt con testo + immagini — riusare il supporto
  multimodale di `ContentPart`)
- `authenticate`: no-op che non dichiara metodi; errore chiaro se chiamato

Done when:

- un client finto completa `initialize` e riceve capabilities corrette
- il server rifiuta con errore JSON-RPC pulito i metodi non ancora supportati

Test:

- nuovo `packages/cli/src/acp/server.test.ts`: handshake su stream in-memory,
  golden della risposta `initialize`

Commit:

- `feat(acp): stdio server skeleton with initialize handshake`

### Task 1.2 — Subcommand `lucky acp` e risoluzione config headless

Scope:

- dispatch del subcommand in `packages/cli/src/index.tsx` (stesso pattern di
  `lucky mcp`/`lucky update`): `lucky acp` avvia il server su stdin/stdout;
  **tutto il logging va su stderr** (stdout è il canale JSON-RPC)
- risoluzione provider/model/credenziali dalla config salvata senza setup
  interattivo; flag `-p`/`-m` rispettati; se `needsSetup` → exit con messaggio
  "run `lucky` once to set up a provider"

Done when:

- `lucky acp` parte e resta in ascolto con una config valida; esce con
  messaggio chiaro senza config; nessun output spurio su stdout

Test:

- unit sul resolver headless (config finta con/senza credenziali)
- smoke: spawn del processo con config finta, handshake `initialize` reale

Commit:

- `feat(cli): lucky acp subcommand with headless config resolution`

## Milestone 2 — Sessioni e prompt in streaming

### Task 2.1 — `session/new`: costruzione dell'agente per sessione

Scope:

- registry `sessionId → { agent, runtime, abort }` nel server
- `session/new(cwd, mcpServers)` → `buildAgentRuntime` con `cwd` del client;
  gli `mcpServers` passati dall'editor si sommano a quelli della config Lucky
  (precedenza alla config locale in caso di conflitto di nome)
- bridge stub in questa fase: `approveTool` nega con messaggio "not wired yet"
  (rimpiazzato in M4), `askUser`/`presentPlan` assenti
- graph enricher e skills passano invariati da `buildAgentRuntime` (nessun
  lavoro: verificare solo che il wiring esistente regga senza UI)

Done when:

- due `session/new` consecutive producono sessioni indipendenti con cwd diversi

Test:

- `server.test.ts`: creazione sessione con provider scriptato iniettato
  (aggiungere al builder un'iniezione del provider per i test, se non basta
  quella esistente)

Commit:

- `feat(acp): session creation backed by the agent runtime`

### Task 2.2 — `session/prompt` con streaming degli eventi

Scope:

- content blocks ACP → `ContentPart[]` (testo, immagini; resto → errore gentile)
- pompa eventi: `text` → `session/update agent_message_chunk`;
  `turn_end` → risposta con `stopReason: end_turn`; `error` → JSON-RPC error;
  usage/context → campi `_meta` degli update (non-standard ma utile)
- un solo prompt in volo per sessione: un secondo `session/prompt` mentre uno
  gira → errore

Done when:

- un prompt scriptato streama i chunk nell'ordine giusto e chiude con
  `end_turn`

Test:

- `server.test.ts`: sequenza notifiche golden per un turno testo-solo;
  prompt concorrente rifiutato

Commit:

- `feat(acp): streaming prompt turns`

### Task 2.3 — `session/cancel`

Scope:

- `session/cancel` → `AbortController.abort()` sulla sessione; il turno chiude
  con `stopReason: cancelled` (mappa dell'evento `aborted`)
- disconnessione del client (stdin EOF) → abort di tutte le sessioni e exit
  pulito

Done when:

- cancel a metà stream produce `cancelled` e la sessione resta usabile per il
  prompt successivo (il transcript resta consistente: già garantito da
  `finalizeInterrupted`)

Test:

- cancel durante uno stream scriptato lento; prompt successivo funziona

Commit:

- `feat(acp): prompt cancellation and clean shutdown`

## Milestone 3 — Tool call nell'UI dell'editor

### Task 3.1 — Mappatura tool_start/tool_end

Scope:

- `tool_start` → update `tool_call` con `title`, `kind` mappato dal nome tool
  (read/list/glob/grep → `read`|`search`; write/edit/apply_patch → `edit`;
  exec/powershell → `execute`; http_fetch → `fetch`; graph_*/skill_* → `think`
  o `other`), `status: in_progress`, `rawInput`
- `tool_end` → `tool_call_update` con `status: completed|failed` e content
  testuale
- i tool nascosti nella TUI (`task_*`, `ask_user`) restano nascosti anche qui
  (stessa lista `HIDDEN_TOOLS`, spostata in un modulo condiviso se serve)

Done when:

- un turno con tool scriptato produce la coppia tool_call/tool_call_update
  corretta

Test:

- turno con tool finto ok e tool finto in errore; golden degli update

Commit:

- `feat(acp): tool call reporting`

### Task 3.2 — Diff e locations

Scope:

- `ToolResultMetadata` (i diff che la TUI già mostra) → content `diff` ACP
  (path assoluto, oldText/newText)
- `locations` sugli update dei tool file-based, per il "follow along"
  dell'editor

Done when:

- un `edit_file` scriptato produce un tool_call_update con blocco diff che un
  client finto sa leggere

Test:

- golden del diff content da metadata reali di `edit_file`/`apply_patch`

Commit:

- `feat(acp): diff content and file locations on tool calls`

## Milestone 4 — Permessi e modalità

### Task 4.1 — `session/request_permission`

Scope:

- bridge `approveTool` reale: richiesta al client con opzioni
  `allow_once` / `allow_always` / `reject_once` (stessa semantica della TUI)
- `allow_always` alimenta la memoria approvazioni di sessione esistente
  (per-comando per exec, per-tool per i write — riusare la logica della TUI,
  estraendola in un helper condiviso se oggi vive dentro App)
- outcome `cancelled` → il tool risulta negato senza rompere il turno

Done when:

- il flusso approva/nega/ricorda funziona contro un client finto

Test:

- tre scenari (once/always/reject) + cancel; verifica che "always" non
  ri-prompti nello stesso processo

Commit:

- `feat(acp): tool permission requests`

### Task 4.2 — Session modes

Scope:

- advertise dei modi in `session/new` (`default`, `accept-edits`,
  `bypass-permissions` — allineati al `permissionMode` della TUI)
- `session/set_mode` → cambia la policy di risoluzione approvazioni della
  sessione; notifica `current_mode_update` quando cambia lato agente

Done when:

- in `accept-edits` i write-tool non generano richieste di permesso; in
  `default` sì

Test:

- switch di modo a metà sessione, verifica della policy effettiva

Commit:

- `feat(acp): session modes mapped to permission policy`

## Milestone 5 — Piani, ask_user, resume

### Task 5.1 — Piani e task nell'editor

Scope:

- bridge `presentPlan` → update `plan` (entries con priority/status);
  decisione dell'utente via `session/request_permission` (approve/reject plan)
- i task tool (`task_create`/`task_update`…) → update `plan` incrementali,
  così la checklist live della TUI ha un equivalente editor

Done when:

- un turno con present_plan scriptato mostra il piano e rispetta la decisione

Test:

- piano approvato e piano rifiutato; update di stato dei task riflessi

Commit:

- `feat(acp): plan and task reporting`

### Task 5.2 — Strategia `ask_user`

Scope:

- ACP non ha domande a testo libero mid-turn: implementare il fallback deciso
  in studio — il bridge `askUser` in modalità ACP restituisce al tool un
  errore-istruzione ("ask the user in plain text and end the turn"); il
  modello chiude il turno con la domanda nel testo e la risposta arriva come
  prompt successivo
- documentare il comportamento nel system prompt solo se i test mostrano che
  il modello non lo fa da solo (decidere sul campo)

Done when:

- un turno che invoca ask_user termina con la domanda in chiaro, senza hang

Test:

- turno scriptato con ask_user; nessuna richiesta pendente resta aperta

Commit:

- `feat(acp): ask_user fallback for editors`

### Task 5.3 — `session/load`

Scope:

- resume dal session store esistente: replay della history al client via
  `session/update` (come richiede il protocollo), poi sessione attiva
- id sessione ACP ↔ id sessione Lucky: riusare gli id Lucky se compatibili,
  altrimenti mappa persistita

Done when:

- una sessione salvata dalla TUI si riapre nell'editor con transcript completo

Test:

- load di una sessione fixture; replay golden; prompt successivo funziona

Commit:

- `feat(acp): session resume with history replay`

## Milestone 6 — Filesystem dell'editor (buffer non salvati)

### Task 6.1 — Hook di override FS nel core

Scope:

- estendere `ToolContext` (core) con override opzionali di lettura/scrittura
  file (`readTextFile?`, `writeTextFile?`) usati da `read_file`, `write_file`,
  `edit_file`, `apply_patch` al posto dell'accesso disco quando presenti
- sandbox invariata: gli override ricevono path già validati

Done when:

- i quattro tool usano l'override quando fornito, disco altrimenti; nessun
  cambio di comportamento senza override

Test:

- unit dei quattro tool con override finti (core, offline)

Commit:

- `feat(core): pluggable file access for editor-backed tools`

### Task 6.2 — Wiring `fs/read_text_file` / `fs/write_text_file`

Scope:

- se il client advertise le fs capabilities, gli override del task 6.1 puntano
  ai metodi ACP: l'agente vede i buffer non salvati e le modifiche appaiono
  come edit nel buffer dell'editor
- fallback trasparente al disco se il client non le espone o risponde errore

Done when:

- read_file su un "buffer sporco" finto ritorna il contenuto del client, non
  del disco

Test:

- client finto con fs capabilities; casi buffer/disco/errore-fallback

Commit:

- `feat(acp): editor filesystem integration`

## Milestone 7 — Hardening, e2e e docs

### Task 7.1 — Test end-to-end del server

Scope:

- un test integrazione che guida `lucky acp` (in-process) su un turno completo:
  initialize → new → prompt → tool con permesso → diff → end_turn → cancel su
  secondo turno → load
- error taxonomy: ogni eccezione interna diventa un errore JSON-RPC con
  messaggio umano, mai un crash del processo

Done when:

- il flusso completo passa offline; un tool che lancia non uccide il server

Test:

- il suddetto e2e + fault injection sul registry dei tool

Commit:

- `test(acp): end-to-end editor session flow`

### Task 7.2 — Docs e config per gli editor

Scope:

- sezione README "Use LuckyCLI from your editor" con snippet di config per
  Zed (`agent_servers`), JetBrains, Neovim (CodeCompanion/avante) e VS Code
  (estensione ACP community)
- aggiornare questo file con lo stato finale dei task

Done when:

- un utente segue il README e collega Zed a `lucky acp` senza altre fonti

Test:

- verifica manuale con almeno un editor reale (Zed) contro un provider vero

Commit:

- `docs: editor integration guide for lucky acp`

## Fuori scope v1 (annotare, non fare)

- metodi `terminal/*` ACP (l'exec resta interno con output testuale)
- OAuth/`authenticate` dentro l'editor
- daemon condiviso multi-editor / multi-processo
- estensione VS Code propria (si valuta dopo la trazione con le estensioni
  ACP community)
- slash-command / skills panel via ACP (le skills restano attivabili dal
  modello con `skill_search`/`skill_load`, che funzionano già)

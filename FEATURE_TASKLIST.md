# Feature Task List — workflow sicuro e automazione

Roadmap proposta per le prossime feature di LuckyCLI. L'obiettivo è completare
il ciclo di lavoro dell'agente:

```text
capire → modificare → verificare → revisionare → ripristinare
```

La roadmap è pensata per il branch `feat/agent-workflow`. Ogni task è
indipendente, deve lasciare il progetto compilabile e chiude con un solo commit
mirato. Non sono previsti nuovi package npm senza approvazione esplicita.

## Regole operative

- I test devono essere offline: provider scriptati, filesystem temporanei e
  trasporti finti; mai API live.
- Ogni modifica comportamentale deve avere test automatici nello stesso task.
- Core resta provider-agnostic; la UI e il parsing dei comandi restano nel cli.
- Prima del commit di ogni task eseguire, in quest'ordine:

  ```bash
  git diff
  git status
  npm run typecheck
  npm test
  npm run build
  git diff --cached --stat
  ```

- Se un comando fallisce, correggere la causa e ripetere la sequenza dall'inizio.
- Non includere `dist/`, `node_modules/`, credenziali o file temporanei.

## Milestone 0 — baseline e contratti

### Task 0.1 — Registrare la baseline

Scope:

- eseguire typecheck, test e build sul branch di lavoro;
- annotare qui eventuali failure preesistenti;
- verificare che il working tree sia pulito prima di iniziare.

Done when:

- la baseline è verde oppure ogni failure preesistente è riportata con output
  sintetico e non viene attribuita ai task successivi.

Test/verifica:

- `npm run typecheck`
- `npm test`
- `npm run build`

Commit dettagliato:

```text
docs: record feature roadmap baseline

Record the repository verification baseline and establish the execution rules
for the workflow feature roadmap.

Co-Authored-By: Claude <noreply@anthropic.com>
```

### Task 0.2 — Definire i contratti di verifica e checkpoint

Scope:

- documentare in `packages/core/src/` i tipi necessari per un risultato di
  verifica e per un checkpoint;
- definire stati minimi: `pending`, `running`, `passed`, `failed`, `cancelled`;
- definire identificatore, timestamp, working directory e file coinvolti;
- non implementare ancora persistenza o comandi UI.

Done when:

- i contratti sono tipizzati senza `any` e chiariscono cosa è pubblico e cosa è
  interno;
- i tipi non importano nulla dal cli.

Test:

- test di costruzione e serializzazione dei tipi;
- test dei casi invalidi e degli stati terminali.

Commit dettagliato:

```text
docs(core): define verification and checkpoint contracts

Document the stable data shapes used by the upcoming workflow features.
Keep the contracts provider-agnostic and independent from the TUI.

Co-Authored-By: Claude <noreply@anthropic.com>
```

## Milestone 1 — checkpoint, undo e ripristino

### Task 1.1 — Snapshot sicuro dei file modificati

Scope:

- aggiungere in core un servizio di snapshot per file dentro la working
  directory;
- salvare contenuto, esistenza precedente, permessi rilevanti e hash;
- usare scrittura atomica e directory dedicata sotto `.lucky/`;
- escludere `.lucky/`, `node_modules/` e path fuori dalla root;
- non alterare ancora il comportamento dell'agent loop.

Done when:

- uno snapshot può essere creato e letto senza perdere file vuoti o binari;
- path assoluti, traversal e symlink fuori root vengono rifiutati;
- snapshot incompleti non risultano validi.

Test:

- file nuovo, modificato, cancellato e vuoto;
- directory annidata e nomi con spazi/unicode;
- traversal, path assoluto e symlink;
- interruzione simulata durante la scrittura atomica.

Commit dettagliato:

```text
feat(core): add atomic file workflow snapshots

Store validated file snapshots under the project metadata directory so later
undo operations can restore an exact pre-edit state.

Co-Authored-By: Claude <noreply@anthropic.com>
```

### Task 1.2 — Registro dei checkpoint per sessione

Scope:

- collegare snapshot e sessione persistente;
- aggiungere creazione, elenco, caricamento e rimozione di checkpoint;
- conservare titolo, motivo, file coinvolti e stato di validità;
- mantenere compatibilità con le sessioni esistenti prive di checkpoint.

Done when:

- checkpoint di sessioni diverse non si sovrascrivono;
- un checkpoint corrotto viene ignorato con errore esplicito;
- il caricamento di una sessione precedente continua a funzionare.

Test:

- round-trip completo del registro;
- isolamento tra sessioni;
- ordinamento temporale deterministico;
- JSON legacy senza il nuovo campo;
- dati corrotti e checkpoint mancanti.

Commit dettagliato:

```text
feat(session): persist workflow checkpoints per session

Associate atomic snapshots with saved sessions while preserving compatibility
with existing session files.

Co-Authored-By: Claude <noreply@anthropic.com>
```

### Task 1.3 — Restore e protezione da conflitti

Scope:

- implementare restore di un checkpoint;
- verificare l'hash attuale prima di sovrascrivere un file;
- segnalare conflitti e permettere una policy esplicita `abort`/`force`;
- ripristinare anche file creati dopo il checkpoint quando appartengono alla
  stessa operazione e sono ancora invariati.

Done when:

- il restore non perde modifiche esterne non riconducibili al checkpoint;
- in caso di conflitto nessun file viene modificato con policy `abort`;
- il risultato elenca ripristinati, saltati e conflitti.

Test:

- restore riuscito di edit, create e delete;
- conflitto su file modificato dopo il checkpoint;
- rollback transazionale quando un file fallisce;
- policy `force` esplicita;
- restore ripetuto idempotente.

Commit dettagliato:

```text
feat(core): restore checkpoints without clobbering changes

Restore workflow snapshots with hash-based conflict detection and explicit
abort or force policies.

Co-Authored-By: Claude <noreply@anthropic.com>
```

### Task 1.4 — Comandi `/checkpoint`, `/undo` e `/restore`

Scope:

- aggiungere comandi CLI per creare, elencare, ripristinare e rimuovere;
- mostrare sempre file coinvolti e conflitti prima di un restore;
- chiedere approvazione per operazioni distruttive;
- aggiungere alias minimi solo se coerenti con il registry esistente.

Done when:

- i comandi sconosciuti o con argomenti invalidi non raggiungono il modello;
- `/undo` usa l'ultimo checkpoint valido della sessione corrente;
- il testo mostrato è utile anche in terminali stretti.

Test:

- test dei command handler con `CommandContext` finto;
- argomenti invalidi e checkpoint assente;
- approvazione, rifiuto e conflitto;
- registry/menu/help aggiornati da una sola fonte.

Commit dettagliato:

```text
feat(cli): expose checkpoint and restore commands

Add safe session-scoped checkpoint, undo and restore commands with explicit
approval for destructive restores.

Co-Authored-By: Claude <noreply@anthropic.com>
```

## Milestone 2 — verifica automatica

### Task 2.1 — Resolver dei comandi di verifica

Scope:

- rilevare package manager e script già dichiarati nel progetto;
- riconoscere TypeScript, test runner e configurazioni comuni già presenti;
- produrre una lista ordinata e deduplicata di comandi candidati;
- non eseguire ancora i comandi e non inventare dipendenze.

Done when:

- il resolver preferisce gli script del progetto;
- non propone comandi se non esiste una configurazione attendibile;
- shell, quoting e directory di esecuzione sono rappresentati in modo tipizzato.

Test:

- fixture npm con `typecheck`, `test`, `build`;
- fixture senza script;
- monorepo con workspace;
- package manager npm/pnpm/yarn/bun già indicati dai file lock;
- script duplicati e ordine deterministico.

Commit dettagliato:

```text
feat(core): resolve project verification commands

Discover existing project checks from repository configuration without adding
implicit commands or dependencies.

Co-Authored-By: Claude <noreply@anthropic.com>
```

### Task 2.2 — Runner con timeout, cancellazione e output limitato

Scope:

- eseguire i check risolti usando il meccanismo shell già presente;
- supportare timeout, abort e limite di output;
- emettere eventi strutturati per start, output, exit e failure;
- evitare che un processo figlio resti vivo dopo cancellazione.

Done when:

- il runner restituisce exit code, durata e output senza segreti;
- timeout e cancellazione hanno stati distinti;
- l'ordine degli eventi è stabile.

Test:

- comando riuscito e comando fallito;
- output oltre il limite;
- timeout;
- abort durante l'esecuzione;
- exit code non-zero e processo figlio terminato.

Commit dettagliato:

```text
feat(core): run verification checks with cancellation

Execute resolved project checks with bounded output, timeout handling and
structured lifecycle events.

Co-Authored-By: Claude <noreply@anthropic.com>
```

### Task 2.3 — Tool `verify` e integrazione post-edit

Scope:

- aggiungere un tool core `verify` che usa resolver e runner;
- includere nel risultato file modificati, check eseguiti e failure;
- aggiungere una modalità configurabile `manual`/`after-edit`;
- eseguire automaticamente solo dopo una modifica approvata, mai dopo una
  semplice lettura.

Done when:

- il modello riceve un risultato compatto ma sufficiente per correggere errori;
- un check fallito non viene presentato come successo;
- il comportamento predefinito è documentato e coperto da test.

Test:

- schema Zod e validazione input;
- nessuna modifica → nessun run automatico;
- edit approvato → verifica avviata;
- edit rifiutato/fallito → verifica non avviata;
- successo parziale, failure e cancellazione;
- compatibilità con provider scriptato.

Commit dettagliato:

```text
feat(agent): verify approved edits automatically

Expose project checks as a structured tool and optionally run them after
successful approved edits.

Co-Authored-By: Claude <noreply@anthropic.com>
```

### Task 2.4 — Comando `/verify` e pannello risultato

Scope:

- aggiungere `/verify`, `/verify last` e `/verify cancel`;
- mostrare check in esecuzione, durata, exit code e output troncato;
- mantenere navigabile la sessione durante un check;
- aggiungere compatibilità ACP per gli eventi già rappresentabili.

Done when:

- il comando riusa il servizio core senza duplicare logica;
- un secondo run concorrente viene rifiutato o accodato secondo policy
  documentata;
- TUI e ACP non divergono sui risultati.

Test:

- command handler e render dei tre stati principali;
- run concorrente;
- cancellazione;
- output stretto/largo;
- golden ACP degli eventi di verifica.

Commit dettagliato:

```text
feat(cli): add interactive verification command

Display live project checks and their results in the TUI while reusing the
provider-agnostic verification service.

Co-Authored-By: Claude <noreply@anthropic.com>
```

## Milestone 3 — review del diff

### Task 3.1 — Raccolta diff e contesto locale

Scope:

- raccogliere il diff rispetto al checkpoint o a `HEAD` secondo una scelta
  esplicita;
- includere solo file nel working directory;
- aggiungere contesto limitato per hunk e metadati di file;
- redigere token/password/segreti ovvi prima di passarli al modello.

Done when:

- la sorgente del diff è visibile nel risultato;
- file binari e diff troppo grandi sono rappresentati con un riassunto;
- la redazione non altera il file sul disco.

Test:

- diff staged, unstaged e checkpoint;
- file nuovo, rimosso, rinominato e binario;
- diff oltre il limite;
- fixture con chiavi e token da redigere;
- path fuori root e repository senza Git.

Commit dettagliato:

```text
feat(core): collect bounded and redacted review diffs

Build review input from explicit diff sources while protecting local files and
limiting model context size.

Co-Authored-By: Claude <noreply@anthropic.com>
```

### Task 3.2 — Prompt e schema del reviewer

Scope:

- definire prompt provider-agnostic per review tecnica;
- richiedere finding con severità, file, linea, spiegazione e fix suggerito;
- distinguere `bug`, `security`, `breaking-change`, `test-gap` e `style`;
- validare la risposta del modello e degradare a testo leggibile se necessario.

Done when:

- la risposta non può inventare file fuori dal diff senza segnalarlo;
- finding duplicati vengono normalizzati;
- lo schema è riutilizzabile da TUI, ACP e headless.

Test:

- prompt con diff piccolo e multi-file;
- risposta valida, incompleta e malformata;
- finding duplicati e linee fuori range;
- nessun finding;
- provider scriptato con errori e interruzione.

Commit dettagliato:

```text
feat(core): add structured diff review contract

Define validated review findings and a compact provider-agnostic review prompt
for TUI, ACP and headless clients.

Co-Authored-By: Claude <noreply@anthropic.com>
```

### Task 3.3 — `/review` e navigazione dei finding

Scope:

- aggiungere `/review [checkpoint|head]`;
- mostrare finding ordinati per severità e posizione;
- permettere apertura del file/linea quando il terminale lo supporta;
- collegare review, verifica e checkpoint nel riepilogo del turno.

Done when:

- `/review` senza diff termina con messaggio chiaro;
- i finding non vengono confusi con output del modello;
- errori di review non interrompono la sessione.

Test:

- command handler con reviewer finto;
- ordinamento e deduplicazione;
- review vuota, fallita e cancellata;
- terminale senza supporto hyperlink;
- snapshot del riepilogo combinato review/verify.

Commit dettagliato:

```text
feat(cli): add interactive diff review

Expose structured review findings with severity ordering, safe diff selection
and terminal-friendly navigation.

Co-Authored-By: Claude <noreply@anthropic.com>
```

## Milestone 4 — headless e CI

### Task 4.1 — Comando `lucky run` non-interattivo

Scope:

- aggiungere `lucky run <prompt>` e input da stdin/file;
- supportare provider/model già configurati e override da flag;
- definire exit code per successo, failure, cancellazione e setup mancante;
- vietare prompt interattivi quando `--non-interactive` è attivo.

Done when:

- stdout contiene solo il risultato richiesto e stderr solo diagnostica;
- nessun OAuth/setup apre prompt interattivi;
- sessione e output possono essere salvati esplicitamente.

Test:

- prompt inline, stdin e file;
- successo, errore provider e setup mancante;
- tool che richiede approval in modalità non-interactive;
- exit code e separazione stdout/stderr;
- provider scriptato in processo isolato.

Commit dettagliato:

```text
feat(cli): add non-interactive run mode

Run configured agent tasks from the command line with deterministic streams,
exit codes and no interactive authentication or approval prompts.

Co-Authored-By: Claude <noreply@anthropic.com>
```

### Task 4.2 — Output JSON e comandi CI

Scope:

- aggiungere `--format text|json|jsonl` a `run`, `verify` e `review`;
- definire schema versionato e documentato;
- non inserire token, header o credenziali nei risultati;
- rendere gli eventi ACP convertibili senza perdere errori.

Done when:

- JSON è parseabile anche quando il modello produce markdown;
- ogni evento ha tipo e versione;
- gli errori hanno forma stabile e exit code coerente.

Test:

- golden text/JSON/JSONL;
- caratteri unicode, newline e output vuoto;
- errori serializzati;
- segreti nelle fixture;
- compatibilità tra stream interrotto e stream completato.

Commit dettagliato:

```text
feat(cli): add versioned machine-readable output

Provide stable text, JSON and JSONL output formats for automation and CI
without leaking provider credentials.

Co-Authored-By: Claude <noreply@anthropic.com>
```

### Task 4.3 — Configurazione per progetto

Scope:

- supportare `.lucky/config.json` locale con schema validato;
- definire precedenza: flag → progetto → globale → default;
- configurare check, esclusioni graph, skill, MCP e permission mode;
- rifiutare valori sconosciuti o path che escono dalla root.

Done when:

- configurazione globale e locale non si sovrascrivono accidentalmente;
- segreti locali non vengono stampati;
- setup esistente continua a funzionare senza file di progetto.

Test:

- merge delle quattro precedenze;
- file assente, invalido e con chiavi sconosciute;
- path relativi e traversal;
- config legacy globale;
- permission mode e check configurati per progetto.

Commit dettagliato:

```text
feat(config): support project-local Lucky settings

Load validated project configuration with explicit precedence for checks,
permissions, skills, MCP and graph behavior.

Co-Authored-By: Claude <noreply@anthropic.com>
```

## Milestone 5 — MCP e knowledge graph

### Task 5.1 — MCP prompts e resources nel core

Scope:

- esporre API core per elencare e leggere prompts/resources MCP;
- applicare timeout, limiti di dimensione e gestione errori già usati dai tool;
- mantenere isolamento tra server e nomi dei contenuti;
- non aggiungere ancora UI.

Done when:

- prompt/resource non vengono confusi con tool call;
- server lento o non disponibile non blocca gli altri server;
- contenuti troppo grandi vengono troncati in modo dichiarato.

Test:

- server finto con prompt e resource;
- server senza capability;
- timeout, errore e contenuto oltre limite;
- collisioni di nomi;
- server locale e remoto tramite trasporti finti.

Commit dettagliato:

```text
feat(mcp): expose prompts and resources through core APIs

Add bounded, isolated MCP prompt and resource access without coupling the core
to the TUI.

Co-Authored-By: Claude <noreply@anthropic.com>
```

### Task 5.2 — Pannello `/mcp` per prompts/resources e refresh tool

Scope:

- aggiungere viste e comandi `/mcp prompts` e `/mcp resources`;
- visualizzare server, nome, descrizione e dimensione;
- reagire a `tools/list_changed` con refresh controllato;
- evitare race tra reconnect, disable e refresh.

Done when:

- il pannello mostra stato aggiornato senza riavviare LuckyCLI;
- un server disabilitato non riceve refresh;
- errori di refresh sono visibili ma non terminano la sessione.

Test:

- command handler e hook del pannello;
- eventi `list_changed` duplicati e ravvicinati;
- reconnect e disable durante refresh;
- prompt/resource vuoti o non disponibili;
- golden del menu e dello stato server.

Commit dettagliato:

```text
feat(cli): browse MCP prompts and live tool updates

Surface MCP prompts and resources in the control panel and refresh registered
tools safely when servers announce changes.

Co-Authored-By: Claude <noreply@anthropic.com>
```

### Task 5.3 — Graph: nuovi file e analisi impatto

Scope:

- rilevare file creati da tool built-in e MCP;
- aggiornare o rimuovere i nodi senza rebuild completo;
- aggiungere query `impact`, `dependents` e `module-boundary`;
- mantenere risultati deterministici e limitati.

Done when:

- un nuovo file appare nel graph dopo la modifica senza rebuild manuale;
- file rimossi non restano interrogabili;
- l'analisi impatto distingue dipendenze certe da collegamenti euristici.

Test:

- create/update/delete da tool built-in;
- create/update/delete notificato da MCP;
- query su simbolo e file sconosciuti;
- cicli, nodi esterni e limiti risultato;
- rebuild completo produce lo stesso risultato incrementale.

Commit dettagliato:

```text
feat(graph): track external edits and analyze impact

Keep the knowledge graph current for MCP-created files and expose bounded
dependency-impact queries for safer edits.

Co-Authored-By: Claude <noreply@anthropic.com>
```

## Milestone 6 — costi, affidabilità e chiusura

### Task 6.1 — Usage e cost tracking locale

Scope:

- normalizzare usage già riportato dai provider;
- registrare token, durata e costo stimato per turno/sessione;
- supportare prezzi configurabili senza hardcodare valori non verificati;
- aggiungere `/usage` e `/cost`.

Done when:

- usage assente è distinto da zero;
- stime e valori provider-reported sono identificati chiaramente;
- nessun dato sensibile viene persistito nei report.

Test:

- provider con usage completo, parziale e assente;
- arrotondamento e overflow;
- prezzi mancanti e configurati;
- sessione ripresa;
- output TUI e JSON.

Commit dettagliato:

```text
feat(core): track session usage and estimated cost

Normalize provider usage and expose opt-in local cost summaries without
claiming precision when pricing or token counts are unavailable.

Co-Authored-By: Claude <noreply@anthropic.com>
```

### Task 6.2 — Retry, fallback e resume dopo errore

Scope:

- aggiungere retry con backoff solo per errori transienti classificati;
- supportare fallback configurabile provider/model;
- preservare transcript e tool state dopo errore di rete;
- rendere cancellabile ogni attesa.

Done when:

- errori auth, validation e approval non vengono ritentati automaticamente;
- retry e fallback sono mostrati all'utente;
- nessun tool side-effecting viene eseguito due volte senza idempotency policy.

Test:

- timeout, 429, 5xx e connessione interrotta;
- errori non transienti senza retry;
- fallback riuscito e fallito;
- cancellazione durante backoff;
- tool call interrotta e ripresa della sessione.

Commit dettagliato:

```text
feat(agent): retry transient failures with safe fallback

Recover from transient provider failures with cancellable backoff and explicit
fallback policy while protecting side-effecting tool calls.

Co-Authored-By: Claude <noreply@anthropic.com>
```

### Task 6.3 — Documentazione, smoke test e chiusura roadmap

Scope:

- aggiornare README con comandi, configurazione ed exit code effettivamente
  implementati;
- aggiungere esempi CI senza credenziali reali;
- verificare manualmente TUI, ACP e headless sui flussi principali;
- registrare limiti rimasti e feature non incluse.

Done when:

- README non dichiara feature non presenti;
- test automatici e smoke test coprono create → verify → review → restore;
- la roadmap riporta commit reali e stato finale.

Test/verifica:

- `npm run typecheck`
- `npm test`
- `npm run build`
- smoke manuale `npm run dev`
- smoke manuale `lucky acp` con client finto
- smoke manuale `lucky run --non-interactive`

Commit dettagliato:

```text
docs: document agent workflow and verification commands

Document the implemented checkpoint, verification, review, headless and
recovery workflows, including their limitations and automation examples.

Co-Authored-By: Claude <noreply@anthropic.com>
```

## Ordine consigliato dei commit

```text
docs(core): define verification and checkpoint contracts
feat(core): add atomic file workflow snapshots
feat(session): persist workflow checkpoints per session
feat(core): restore checkpoints without clobbering changes
feat(cli): expose checkpoint and restore commands
feat(core): resolve project verification commands
feat(core): run verification checks with cancellation
feat(agent): verify approved edits automatically
feat(cli): add interactive verification command
feat(core): collect bounded and redacted review diffs
feat(core): add structured diff review contract
feat(cli): add interactive diff review
feat(cli): add non-interactive run mode
feat(cli): add versioned machine-readable output
feat(config): support project-local Lucky settings
feat(mcp): expose prompts and resources through core APIs
feat(cli): browse MCP prompts and live tool updates
feat(graph): track external edits and analyze impact
feat(core): track session usage and estimated cost
feat(agent): retry transient failures with safe fallback
docs: document agent workflow and verification commands
```

Ogni commit deve avere il footer richiesto dal repository:

```text
Co-Authored-By: Claude <noreply@anthropic.com>
```

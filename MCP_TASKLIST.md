# MCP Task List

Branch di lavoro: `feat/mcp`

Regola operativa per tutto questo lavoro:

- ogni task deve chiudersi con:
  - test eseguiti e verdi per lo scope del task
  - commit mirato, con prefisso convenzionale tipo `feat:`, `refactor:`, `test:`, `docs:`
- niente task "lunghi" che mischiano runtime, catalogo, auth e CLI nello stesso commit
- niente merge su `main` finche' non chiudiamo tutte le milestone concordate

## Milestone 0 - Baseline e guardrail

### Task 0.1 - Mettere a terra il piano tecnico

Scope:

- consolidare studio e task list nel repo
- chiarire target architecture: runtime separato da catalogo
- fissare i confini di `packages/core` e `packages/cli`

Done when:

- `MCP_PORTING_STUDY.md` e `MCP_TASKLIST.md` sono coerenti
- la sequenza di implementazione e' esplicita

Test:

- nessun test runtime richiesto
- verifica manuale del contenuto dei documenti

Commit:

- `docs: add mcp porting study and execution task list`

### Task 0.2 - Fotografare il baseline di Lucky

Scope:

- eseguire suite attuale
- registrare eventuali failure preesistenti prima di toccare MCP

Done when:

- abbiamo una baseline chiara di `build`, `typecheck`, `test`

Test:

- `npm run build`
- `npm run typecheck`
- `npm test`

Commit:

- nessun commit se non ci sono modifiche
- se serve documentare issue preesistenti: `docs: record pre-mcp test baseline`

## Milestone 1 - Fondazioni MCP nel core

### Task 1.1 - Aggiungere i tipi MCP in core

Scope:

- creare `packages/core/src/mcp/types.ts`
- definire tipi per:
  - server local
  - server remote
  - status connessione
  - metadata base tool/resource/prompt

Done when:

- i tipi MCP non dipendono dalla CLI
- il modello dati e' sufficiente per le fasi successive

Test:

- typecheck completo
- eventuali unit test leggeri sui parser/type guards

Commit:

- `feat: add core mcp domain types`

### Task 1.2 - Aggiungere config MCP a Lucky

Scope:

- estendere config store / resolved config con sezione MCP
- decidere il formato persistito in `~/.luckycli/config.json`
- supportare almeno:
  - `local.command`
  - `local.environment`
  - `remote.url`
  - `remote.headers`
  - `enabled`
  - `timeout`

Done when:

- la config MCP e' leggibile dal core senza dipendere dalla UI
- i default e i fallback sono chiari

Test:

- unit test per load/save/resolve config
- `npm run typecheck`

Commit:

- `feat: add lucky mcp config support`

### Task 1.3 - Introdurre il package surface MCP nel core

Scope:

- esportare i moduli MCP da `packages/core/src/index.ts`
- definire API pubblica minima per il runtime MCP

Done when:

- il core espone solo API coerenti e piccole
- nessun dettaglio di SDK trapela inutilmente

Test:

- typecheck
- eventuali test d'import/export se utili

Commit:

- `refactor: expose minimal core mcp public api`

## Milestone 2 - Runtime MCP locale

### Task 2.1 - Implementare adapter MCP tool -> Lucky Tool

Scope:

- creare `mcp/tool-adapter.ts`
- convertire uno schema tool MCP in `Tool` Lucky
- normalizzare nomi, descrizioni, parametri e risultato errore

Done when:

- un tool MCP puo' essere registrato nel `ToolRegistry`
- la conversione non tocca agent loop o provider layer

Test:

- unit test sull'adapter
- verifica JSON Schema / validazione input

Commit:

- `feat: add mcp tool adapter for lucky registry`

### Task 2.2 - Implementare client locale stdio

Scope:

- creare il supporto a server MCP `local`
- avvio processo
- connect via stdio transport
- timeout e gestione errori base

Done when:

- possiamo connetterci a un server MCP locale semplice
- gli errori di startup sono riportati in modo leggibile

Test:

- unit/integration test con server MCP di test
- `npm run typecheck`

Commit:

- `feat: add local stdio mcp client runtime`

### Task 2.3 - Implementare `McpManager` minimo

Scope:

- creare `mcp/manager.ts`
- responsabilita':
  - connettere server configurati
  - mantenere stato
  - esporre tool adattati
  - disconnect/cleanup

Done when:

- il manager gestisce piu server locali
- cleanup corretto dei processi figli

Test:

- unit/integration test sul lifecycle
- test di cleanup

Commit:

- `feat: add mcp manager lifecycle for local servers`

### Task 2.4 - Iniettare tool MCP nel registry runtime

Scope:

- comporre built-in tools + MCP tools in fase di `buildAgent`
- decidere se:
  - estendere `defaultToolRegistry()`
  - oppure creare un registry runtime composito

Done when:

- l'agent vede anche i tool MCP senza modifiche ai provider
- i tool approval flow esistenti continuano a funzionare

Test:

- unit test su `buildAgent`
- agent test end-to-end con uno scripted provider + tool MCP registrato

Commit:

- `feat: register mcp tools in agent runtime`

## Milestone 3 - Runtime MCP remoto

### Task 3.1 - Implementare client remoto HTTP/SSE senza OAuth

Scope:

- supportare server `remote`
- connessione HTTP streamable e SSE
- headers custom
- timeout e fallback transport

Done when:

- un server remoto non autenticato puo' essere usato
- lo status distingue `connected`, `disabled`, `failed`

Test:

- integration test con mock/fake remote server
- test dei fallback di transport

Commit:

- `feat: add remote mcp client transport support`

### Task 3.2 - Uniformare status, error reporting e cleanup

Scope:

- consolidare stato runtime
- normalizzare errori e messaggi
- garantire close ordinato di client locali/remoti

Done when:

- il manager ha semantics stabili e testate
- il chiamante puo' interrogare status in modo affidabile

Test:

- unit test status transitions
- integration test di reconnect/disconnect

Commit:

- `refactor: stabilize mcp runtime status and cleanup`

## Milestone 4 - Surface CLI minima

### Task 4.1 - Aggiungere comandi CLI minimi MCP

Scope:

- comandi iniziali:
  - `lucky mcp list`
  - `lucky mcp doctor` oppure `lucky mcp status`
- output leggibile senza TUI complessa

Done when:

- possiamo ispezionare config e stato runtime da CLI

Test:

- unit test dove possibile
- smoke test CLI

Commit:

- `feat: add basic mcp cli commands`

### Task 4.2 - Documentare configurazione MCP locale/remota

Scope:

- README o doc dedicata
- esempi minimi reali
- limiti attuali dichiarati chiaramente

Done when:

- un utente puo' configurare almeno un server locale e uno remoto

Test:

- verifica manuale esempi

Commit:

- `docs: document lucky mcp configuration`

## Milestone 5 - Catalogo separato dal runtime

### Task 5.1 - Definire interfacce catalogo

Scope:

- creare `mcp-catalog/types.ts`
- definire:
  - `CatalogSource`
  - `CatalogEntry`
  - `LuckyMcpPreset`

Done when:

- il catalogo non dipende dal runtime manager
- il runtime non dipende da una sorgente catalogo specifica

Test:

- typecheck
- unit test di normalizzazione preset

Commit:

- `feat: add mcp catalog abstraction`

### Task 5.2 - Implementare adapter per Official MCP Registry

Scope:

- client per metadata/preset search
- mapping da record del registry a preset Lucky

Done when:

- Lucky puo' cercare server MCP dal registry ufficiale
- il risultato e' normalizzato in preset interni

Test:

- unit test mapping
- integration test con fixture di risposta API

Commit:

- `feat: add official mcp registry catalog source`

### Task 5.3 - Aggiungere cache/preset locali

Scope:

- memorizzare preset scelti o risolti
- preparare supporto offline/minor network dependency

Done when:

- i preset gia' scelti non richiedono nuova discovery

Test:

- unit test store/load cache

Commit:

- `feat: add local cache for mcp catalog presets`

### Task 5.4 - Aggiungere CLI per discovery/catalogo

Scope:

- comandi iniziali:
  - `lucky mcp search <query>`
  - `lucky mcp add <preset-or-manual>`

Done when:

- si puo' passare da catalogo a config Lucky senza editing manuale obbligatorio

Test:

- smoke test CLI
- unit test del mapping config output

Commit:

- `feat: add mcp catalog search and add commands`

## Milestone 6 - OAuth e feature avanzate

### Task 6.1 - Progettare storage auth MCP

Scope:

- decidere se usare `~/.luckycli/config.json` o file dedicato
- definire formato token e metadata auth

Done when:

- il formato storage e' stabile e separabile dalla config di base

Test:

- unit test store/load auth entries

Commit:

- `feat: add mcp auth storage model`

### Task 6.2 - Implementare OAuth per server remoti

Scope:

- callback server
- PKCE/state handling
- token persistence
- refresh / re-auth base

Done when:

- almeno un server MCP OAuth puo' completare il flow end-to-end

Test:

- unit test auth flow
- integration test callback/state validation

Commit:

- `feat: add oauth flow for remote mcp servers`

### Task 6.3 - Aggiungere prompts/resources MCP

Scope:

- esporre `listPrompts`, `getPrompt`, `listResources`, `readResource`
- decidere se diventano tool Lucky o API interne invocabili da altre surface

Done when:

- Lucky puo' sfruttare anche primitive MCP oltre ai tools

Test:

- integration test su prompt/resource fetch

Commit:

- `feat: add mcp prompts and resources support`

## Milestone 7 - Hardening finale

### Task 7.1 - Test suite completa e gap analysis

Scope:

- eseguire build, typecheck e test completi
- elencare gap residui

Done when:

- abbiamo confidenza realistica prima del merge

Test:

- `npm run build`
- `npm run typecheck`
- `npm test`

Commit:

- `test: cover mcp runtime and catalog integration`

### Task 7.2 - Cleanup e merge prep

Scope:

- ripulire API, naming e docs
- verificare diff finale del branch
- preparare summary per merge su `main`

Done when:

- il branch e' leggibile come sequenza di commit sensati
- non ci sono cambi fuori scope

Test:

- rerun suite completa

Commit:

- `chore: finalize mcp branch for merge`

## Sequenza raccomandata di esecuzione

Ordine pratico:

1. `0.2`
2. `1.1`
3. `1.2`
4. `1.3`
5. `2.1`
6. `2.2`
7. `2.3`
8. `2.4`
9. `3.1`
10. `3.2`
11. `4.1`
12. `4.2`
13. `5.1`
14. `5.2`
15. `5.3`
16. `5.4`
17. `6.1`
18. `6.2`
19. `6.3`
20. `7.1`
21. `7.2`

## Regola di commit

Pattern richiesto:

- un task = un commit principale
- se durante il task emerge un'aggiunta di test separabile, massimo un commit dedicato `test: ...`
- evitare commit omnibus del tipo "misc fixes"

Esempi validi:

- `feat: add core mcp domain types`
- `feat: add local stdio mcp client runtime`
- `test: cover mcp manager cleanup semantics`
- `docs: document lucky mcp configuration`

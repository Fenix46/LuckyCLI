# CC Adaptation Task List — LuckyCLI

Piano esecutivo per adattare a LuckyCLI i pattern di Claude Code 2.1.330 che
mancano. Ogni task è indipendente, lascia il progetto compilabile e si chiude
con **un commit mirato**. Regole del repository (`AGENTS.md`) valgono sempre:
niente nuove dipendenze, niente `any`/`@ts-ignore`, core provider-agnostico,
test offline, branch dedicato, footer di commit richiesto.

- Branch: `feat/cc-adaptations`
- Base: `main` @ `9d558c7` (LuckyCLI 0.7.1)
- Documento di analisi: `CLAUDE_CODE_ADAPTATIONS.md`

## Regole di esecuzione

Prima di ogni commit, in quest'ordine:

```bash
git diff
git status
npm run typecheck
npm test
npm run build
git diff --cached --stat
```

Se un passo fallisce, correggere la causa e ripartire dall'inizio. Non
includere `dist/`, `node_modules/`, `.lucky/` o file temporanei.

Footer richiesto:

```text
Co-Authored-By: <model> <noreply@anthropic.com>
```

## Baseline

Registrata su `main` @ `9d558c7`:

- `npm run typecheck` → verde.
- `npm test` → **1 failure preesistente**: `packages/core/src/skills/graph.test.ts`
  (“keeps the first of two skills sharing a name…”, atteso `a/skill.md`, ricevuto
  `a/SKILL.md`). Causa: su filesystem case-insensitive `findSkillFile` trovava
  `SKILL.md` prima del nome reale `skill.md`.
- `npm run build` → da verificare in T0.

La failure è corretta in T0, così i task successivi partono da una suite verde.

---

## T0 — Igiene baseline: nome reale del file skill

**Stato:** fatto — `72b2628`.

**Scope**

- `packages/core/src/skills/graph.ts`: `findSkillFile` legge le entry della
  directory, preferisce una corrispondenza esatta e solo dopo una
  case-insensitive; restituisce il path con il casing realmente presente.
- Nessun cambiamento di comportamento sulle API pubbliche.

**Done when**

- Il test `skills/graph.test.ts` passa su macOS case-insensitive.
- Typecheck/build verdi.
- Nessun altro file toccato.

**Test**

```bash
npx vitest run packages/core/src/skills/graph.test.ts
```

**Commit**

```text
fix(skills): report the on-disk skill file name

Prefer an exact directory entry before a case-insensitive match so discovery
reports the file that actually exists on case-insensitive filesystems.
```

---

## T1 — Documentazione del piano

**Stato:** fatto — `2e973ea`.

**Scope**

- `CLAUDE_CODE_ADAPTATIONS.md`: analisi LuckyCLI vs Claude Code, gap e roadmap.
- `CC_ADAPTATION_TASKLIST.md`: questo piano, con stati e commit.
- Nessuna modifica al codice.

**Done when**

- I due documenti descrivono scope, test e commit di ogni task.
- Non dichiarano feature non ancora implementate come “fatte”.

**Verifica**

```bash
git diff --stat
```

**Commit**

```text
docs: plan Claude Code adaptations

Record the capability comparison and a task-by-task plan for porting the
missing Claude Code patterns into LuckyCLI without copying its implementation.
```

---

## T2 — File state ledger: read-before-edit enforced

**Stato:** fatto — `5edfa89`.

**Scope**

- `packages/core/src/tools/file-state.ts`:
  - `FileStateLedger` con hash SHA-256 per path assoluto;
  - `recordRead`, `recordWrite`, `forgetPath`, `forgetCalls`, `check`, `clear`;
  - helper `describeFileStateFailure`.
- `packages/core/src/tools/types.ts`: `ToolContext.fileState`.
- `packages/core/src/agent/agent.ts`: crea il ledger, lo passa ai tool, lo
  ripulisce su pruning e compaction.
- `read_file`: registra il contenuto letto.
- `edit_file`, `write_file` (overwrite), `apply_patch` (update/delete):
  - rifiutano un file mai letto;
  - rifiutano un file cambiato dopo la lettura;
  - aggiornano lo stato dopo una scrittura riuscita;
  - `apply_patch` fa preflight di tutti i file prima di scrivere, per non
    lasciare patch parziali.
- Enforcement attivo solo con `ctx.fileState` presente: l’agente lo passa
  sempre, i test diretti del registry mantengono il comportamento storico.

**Done when**

- Edit/write/apply_patch senza lettura → errore leggibile, file invariato.
- Lettura + edit → successo.
- Lettura, modifica esterna, edit → errore “changed on disk”.
- Nuovo file con `write_file`/patch add → successo senza lettura.
- Pruning/compaction rimuovono lo stato delle letture sparite.
- Test dedicati in `filesystem.test.ts`, `robust-tools.test.ts` e
  `file-state.test.ts`.

**Commit**

```text
feat(core): require a fresh read before mutating files

Track the content the model has read per path, refuse blind or stale edits in
the file tools, and keep the ledger in sync with pruning and compaction.
```

---

## T3 — Persistenza degli output lunghi

**Stato:** fatto — `20f1cf0`.

**Scope**

- `packages/core/src/tools/output-store.ts`:
  - scrive in `.lucky/tool-results/` con nome deterministico e permessi 0600;
  - limita la dimensione persistita e dichiara il troncamento.
- `packages/core/src/tools/builtin/exec.ts`:
  - quando l’output supera il budget del modello, persiste il completo e
    aggiunge path + dimensione al risultato;
  - vale anche per `background: true` e per i comandi falliti.
- `packages/core/src/tools/types.ts`: metadata
  `persistedOutputPath` / `persistedOutputBytes`.
- Test in `robust-tools.test.ts`:
  - output piccolo → nessun file;
  - output grande → file completo + nota nel risultato;
  - fallimento con output grande → file completo.

**Done when**

- Il modello può rileggere l’output completo con `read_file`.
- `.lucky/tool-results/` resta gitignored.
- Nessun output viene persistito se la scrittura fallisce (best-effort).

**Commit**

```text
feat(tools): persist truncated tool output under .lucky

Keep the full shell output on disk and point the model at it, so truncation
costs detail rather than information.
```

---

## T4 — Plan mode enforced (core + TUI)

**Stato:** fatto — `be7f8ec`.

**Scope**

- `AgentConfig.planMode` e `Agent.setPlanMode()`.
- In plan mode: tool non-readonly negati; read-only ammessi; comandi shell
  read-only ammessi tramite i classificatori esistenti.
- Nota di plan mode nel system prompt della richiesta, non persistita.
- TUI:
  - `PermissionMode` include `"plan"`;
  - ciclo `normal → acceptEdits → auto → plan → normal`;
  - badge “plan mode on”;
  - `presentPlan` su accept torna a `normal` e chiama `setPlanMode(false)`.
- Test:
  - tool mutante negato in plan mode e permesso dopo `setPlanMode(false)`;
  - tool read-only ammesso;
  - ciclo modalità e `verificationModeFor("plan")`;
  - badge footer.

**Done when**

- In plan mode il modello non può modificare file né lanciare comandi mutanti.
- L’accettazione del piano sblocca l’implementazione senza riavvio.
- La UI mostra chiaramente la modalità.

**Commit**

```text
feat(agent): enforce plan mode for read-only exploration

Deny mutating tools until the plan is accepted, keep read-only shell commands
available, and expose the mode in the TUI cycle and footer.
```

---

## T5 — Plan mode in ACP

**Stato:** fatto — `ee889cf`.

**Scope**

- `AcpSessionMode` e `ACP_SESSION_MODES` includono `"plan"`.
- `setSessionMode` chiama `session.agent.setPlanMode(mode.id === "plan")`.
- `presentPlan` su accept torna a `"default"` e disattiva plan mode.
- Test ACP: roster aggiornato; mode plan blocca un tool mutante; accept
  ripristina default.

**Done when**

- Editor e TUI condividono la stessa semantica di plan mode.
- Il test ACP esistente sul roster è aggiornato.

**Commit**

```text
feat(acp): advertise and enforce plan mode

Expose the read-only planning mode to editors and release it when the user
accepts the plan.
```

---

## T6 — Aggiornamento documentazione e audit

**Stato:** fatto (commit di chiusura).

**Scope**

- Aggiornare `TOOL_PORTING_AUDIT.md` con i nuovi comportamenti.
- Aggiornare `FEATURE_TASKLIST.md`/`README` solo dove necessario.
- Registrare in questo file i commit reali e gli eventuali limiti rimasti.
- Non dichiarare implementato ciò che è solo roadmap.

**Commit**

```text
docs: record the Claude Code adaptation wave

Document the file-state gate, persisted tool output and plan mode, and list the
adaptations intentionally left for later.
```

---

## Chiusura Wave 2

Commit di questa wave:

```text
c0adada perf(tools): cache tool schemas and their serialized size
4f430e4 perf(agent): count the transcript once per step
23fb8d0 feat(cli): make keyboard shortcuts discoverable
a8054d0 feat(cli): warn once when the context window fills up
```

Verifica finale: `npm run typecheck`, `npm test` (176 file, 1.452 test) e
`npm run build` verdi.

## T13 — Session fork / branching

**Stato:** fatto (commit di chiusura).

**Scope**

- `forkSession(sourceId, { throughMessageCount?, title? })` nel session store:
  copia il prefisso scelto, nuovo id/timestamp, mantiene provider/modello/cwd/
  system prompt, non copia checkpoint/usage/prompt-cache key.
- TUI: `/fork` (alias `/branch`) e `/fork <n>` per scegliere il punto di
  diramazione; la conversazione viene ricostruita in-place sul nuovo agent.
- Test: store, comando, registry/menu.

**Commit**

```text
feat(session): fork conversations at a message boundary

Persist a branch as a new session and rebuild the live agent on its prefix,
without copying checkpoints or the prompt-cache routing key.
```

## T14 — Notebook edit

**Stato:** fatto (commit di chiusura).

**Scope**

- Nuovo tool `notebook_edit` per `.ipynb`: replace/insert/delete di una cella,
  cell_type code/markdown, source string o array preservato, output e
  execution_count azzerati quando cambia il codice.
- Read-before-edit e stale detection via `FileStateLedger`; diff e
  `onFilesChanged` come gli altri tool di scrittura.
- Registrato nel default registry, permesso `ask`, prompt e README aggiornati.

**Commit**

```text
feat(tools): add Jupyter notebook cell editing

Support replace, insert and delete on .ipynb files with the same read-before-
edit gate and diff metadata as the other mutation tools.
```

## Fuori da questa iterazione

Restano in roadmap, non in questo branch:

- Hook lifecycle (`PreToolUse`, `PostToolUse`, `UserPromptSubmit`, …).
- LSP tool.
- Web search provider.
- Tool differiti (`ToolSearch`).
- Session fork/branch.
- Team/teammate.
- Notebook/worktree/computer use.
- Cost tracking completo.

Queste aree richiedono contratti, configurazione e superficie UI/permessi
dedicati; vanno affrontate una alla volta con la stessa disciplina.

---

# Wave 2 — performance & UX

Obiettivo: ridurre il costo CPU per step e rendere l'interfaccia più
scopribile, senza cambiare il comportamento dell'agente.

## T7 — Cache delle definizioni tool e del loro costo in caratteri

**Stato:** fatto — `c0adada`.

**Scope**

- `packages/core/src/tools/registry.ts`:
  - cache della conversione zod → JSON Schema per tool (WeakMap);
  - cache dell'array `definitions()` invalidata da `register`;
  - `definitionsJsonLength()` cache del `JSON.stringify` usato dal calcolo del
    contesto.
- `packages/core/src/agent/agent.ts`: `overheadChars()` usa la lunghezza
  cacheata invece di serializzare tutti gli schema a ogni controllo.

**Perché**

`Agent` chiama `definitions()` a ogni step e `overheadChars()` più volte per
step; ogni chiamata rigenera gli schema con `zod-to-json-schema` e li
serializza. Con MCP e molti tool è un hotspot CPU puro, senza alcun beneficio.

**Done when**

- Registrare un tool invalida le cache; i tool esistenti non rigenerano lo
  schema.
- `definitions()` restituisce lo stesso contenuto di prima.
- Test: cache hit, invalidazione su register, schema di un tool MCP
  `parametersSchema` preservato, lunghezza JSON coerente.

**Commit**

```text
perf(tools): cache tool schemas and their serialized size

Avoid regenerating every JSON Schema on each agent step and every context
estimate; invalidate only what a newly registered tool changes.
```

## T8 — Un solo conteggio del transcript per step

**Stato:** fatto — `4f430e4`.

**Scope**

- `packages/core/src/agent/agent.ts`:
  - `estimatedStatus`/`cheapContextStatus` accettano una lunghezza già calcolata;
  - in `send`, calcolare `transcriptChars` una volta per step e riusarlo per
    `pruneStatus` e `midStatus`, ricalcolandolo solo dopo un pruning.
- Nessun cambio di semantica: gli stessi numeri, meno scansioni O(history).

**Done when**

- I test di compaction/context accounting restano verdi.
- Un turno con molti step non scandisce il transcript 2–3 volte per step.

**Commit**

```text
perf(agent): count the transcript once per step

Reuse one character count for the pruning and compaction checks, recomputing
only when pruning actually changes the transcript.
```

## T9 — Scopribilità: `/keys` e scorciatoie nell'intro

**Stato:** fatto — `23fb8d0`.

**Scope**

- `packages/cli/src/ui/lib/shortcuts.ts`: elenco unico delle scorciatoie.
- `packages/cli/src/ui/commands/basic.ts`: comando `/keys` che le elenca.
- `IntroBanner`: una riga compatta con `shift+tab`, `/`, `esc`.
- Test del comando `/keys` e del testo nell'intro.

**Done when**

- `/help` resta la lista comandi; `/keys` è la lista scorciatoie.
- L'intro resta su una riga per terminali stretti.

**Commit**

```text
feat(cli): make keyboard shortcuts discoverable

Add a /keys command and a compact shortcut hint to the welcome card.
```

## T10 — Avviso di contesto pieno una tantum

**Stato:** fatto — `a8054d0`.

**Scope**

- `packages/cli/src/ui/lib/context-warning.ts`: soglia e testo.
- `packages/cli/src/ui/App.tsx`: quando `contextStatus.usedPercentage` supera la
  soglia, emettere un solo notice con `/compact` e la nota sul pruning.
- Test della funzione pura; nessun test fragile sull'effetto React.

**Done when**

- Un solo avviso per sessione, non a ogni render.
- Sotto soglia non appare nulla.

**Commit**

```text
feat(cli): warn once when the context window fills up

Surface the existing context meter as an actionable notice with /compact.
```

## T12 — Tool differiti e `tool_search` (MCP)

**Stato:** fatto — `44869a3`.

**Scope**

- `Tool`: flag `defer?: boolean`.
- `McpManager`: i tool MCP nascono `defer: true`.
- `ToolRegistry`:
  - definisce quando differire (soglia di numero o di caratteri degli schema);
  - `definitions()` include solo i tool attivi + `tool_search`;
  - `searchDeferred(query, max)` e `activate(names)`;
  - cache invalidate da `register`/`activate`.
- `ToolContext`: bridge `toolSearch` / `activateTools`.
- `Agent`: passa i bridge al registry.
- Nuovo tool `tool_search`: cerca per nome/descrizione, mostra gli schema dei
  match e li attiva per lo step successivo.
- Permessi: `tool_search` è read-only/allow.
- Prompt: una riga in “Other” spiega quando usarlo.
- Test: soglia, ricerca, attivazione, schema restituito, tool MCP deferito,
  registry di default.

**Perché**

Ogni richiesta porta tutti gli schema dei tool. Con molti server MCP questo è
token e latenza puri, anche quando il modello non userà quei tool. Caricarli su
richiesta riduce il payload fisso e paga lo schema solo quando serve.

**Done when**

- Sotto soglia i tool MCP restano visibili come oggi (nessun cambiamento).
- Sopra soglia `definitions()` non include i tool MCP non attivati.
- `tool_search` li trova, ne restituisce lo schema e li rende chiamabili dallo
  step successivo.
- I test esistenti su MCP e registry restano verdi.

**Commit**

```text
perf(mcp): defer tool schemas behind tool_search

Advertise MCP tools only when their schema budget is small; otherwise let the
model discover and activate them on demand instead of sending every schema on
every request.
```

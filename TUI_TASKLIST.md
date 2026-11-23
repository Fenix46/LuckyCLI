# TUI — task list per menu slash e indicatore di attività

Obiettivo: rendere la TUI più vicina a quella di Claude Code senza cambiare il
modello di interazione. Tre blocchi, ognuno con commit dedicati:

- **A. Affidabilità e presentazione del menu slash** — selezione sempre valida,
  Invio che esegue, Tab che completa, Esc che chiude, hint, colori e categorie.
- **B. Indicatore di attività** — verbi contestuali, retry, coda, MCP.
- **C. Completamento avanzato** — fuzzy matching, comandi recenti, completamento
  argomenti, ghost text inline.

Fuori scope: keybinding configurabili, Ctrl+R, mouse, localizzazione IT/EN,
ridisegno del transcript.

- Branch: `feat/tui-slash`
- Base: `main` @ `0.8.2`
- Regole: `AGENTS.md` (niente dipendenze, niente `any`, test offline, un commit
  per task, typecheck/test/build verdi prima di ogni commit).

---

## Decisioni di progetto

### Menu slash

| Tasto | Comportamento |
|---|---|
| `↑` / `↓` | muove la selezione nella lista filtrata |
| `Tab` | completa il nome del comando selezionato, senza eseguirlo |
| `Invio` | esegue il comando selezionato (se l'input è già un comando esatto, lo esegue) |
| `Esc` | chiude il menu lasciando il testo; con il menu già chiuso pulisce l'input |

- L'indice selezionato viene **azzerato quando cambia la query** e comunque
  clampato alla lunghezza della lista: mai una selezione invisibile.
- La lista mostra il match evidenziato, un badge di categoria e una riga di
  hint in fondo.
- Categorie e colori:
  - `builtin` → `theme.text`
  - `skill` → `theme.primary`
  - `command` (markdown) → `theme.accent`
  - `mcp` (prompt MCP) → `theme.warning`
- Ordine: comandi recenti (stessa sessione) prima, poi per punteggio fuzzy, poi
  per ordine del registro.

### Freschezza della lista

- Skill e comandi markdown restano scoperti all'avvio e ricaricati quando il
  pannello skill cambia o dopo `/skill …` (già fatto in 0.8.2).
- I prompt MCP restano legati a `mcpReady`/manager (già fatto).
- I comandi recenti sono stato di sessione, non persistito.

### Attività

- Il verbo si deduce da ciò che sta succedendo, in quest'ordine:
  1. `compacting` → `Summarizing…`
  2. retry in corso → `Retrying… (n/max)`
  3. tool in esecuzione → verbo del tool (`Reading…`, `Searching…`, `Editing…`,
     `Running…`, `Testing…`, `Fetching…`, `Planning…`, `Delegating…`) + target
  4. reasoning del provider → `Reasoning…`
  5. streaming → `Responding…`
  6. altrimenti → `Thinking…` con sinonimi ruotati ogni 10 secondi
     (`Pondering…`, `Considering…`, `Working it out…`).
- Il dettaglio del tool resta sulla stessa riga; il verbo non lo duplica.
- La coda dei prompt e lo stato MCP vivono nel footer, non nell'indicatore.

---

## Regole di esecuzione

Prima di ogni commit:

```bash
git diff
git status
npm run typecheck
npm test
npm run build
git diff --cached --stat
```

Footer richiesto:

```text
Co-Authored-By: <model> <noreply@anthropic.com>
```

I test dei componenti usano `renderToScreen` del fork Ink (come
`bottom-chrome.test.tsx`); la logica pura (fuzzy, verbi, completamenti) va in
`lib/` con test dedicati.

---

## Task

| Task | Area | Commit |
|---|---|---|
| T0 | Docs: questo piano | `docs: plan the TUI slash and activity work` |
| T1 | Menu: selezione valida, Invio/Tab/Esc | `fix(ui): keep the slash menu selection valid` |
| T2 | Menu: hint, match, categorie e colori | `feat(ui): color and annotate slash menu entries` |
| T3 | Attività: verbi contestuali e retry | `feat(ui): vary the activity indicator by context` |
| T4 | Footer: coda e stato MCP | `feat(ui): show queue and MCP status in the footer` |
| T5 | Menu: fuzzy matching e recenti | `feat(ui): fuzzy-match slash commands and remember recent ones` |
| T6 | Completamento argomenti | `feat(ui): complete command arguments` |
| T7 | Ghost text inline | `feat(ui): preview the selected completion inline` |
| T8 | Docs: README e /keys | `docs: document the TUI improvements` |

---

### T0 — Documentazione del piano

**Scope**

- `TUI_TASKLIST.md`: decisioni, task, test, commit.
- Nessuna modifica al codice.

**Done when**

- Ogni task ha scope, comportamento, test e commit.

**Commit**

```text
docs: plan the TUI slash and activity work
```

---

### T1 — Menu: selezione valida, Invio/Tab/Esc

**Scope**

- `packages/cli/src/ui/App.tsx`:
  - azzerare `selectedCommandIndex` quando cambia `input` (o quando cambia la
    lista filtrata), e clampare l'indice alla lunghezza;
  - `Tab` completa il nome selezionato; `Invio` esegue il comando selezionato;
  - stato `slashMenuDismissed`: `Esc` chiude il menu senza svuotare l'input; un
    secondo `Esc` (menu già chiuso) pulisce l'input;
  - riaprire il menu quando l'input cambia dopo un `Esc`.
- `packages/cli/src/ui/components/SlashMenu.tsx`: accettare una `hint` opzionale
  e mostrarla in fondo (`↑↓ move · tab complete · enter run · esc close`).

**Comportamento**

- Con `/m` → `↓` su `/mcp` → `o`: la lista si riduce a `/model`, la selezione
  torna sulla prima riga e `Invio` esegue `/model` (apre il picker) invece di
  essere inghiottito.
- `Tab` non esegue mai; `Invio` non richiede due pressioni.

**Test**

- `App.test.ts` o un test puro estratto: `clampedSelection(previous, list)`
  esportata da un helper; verifica clamp/reset.
- `bottom-chrome.test.tsx`: `SlashMenu` renderizza la hint.

**Commit**

```text
fix(ui): keep the slash menu selection valid
```

---

### T2 — Menu: hint, match, categorie e colori

**Scope**

- `packages/cli/src/ui/commands/types.ts`: `category?: "builtin" | "skill" |
  "command" | "mcp"` su `Command`.
- `packages/cli/src/ui/commands/registry.ts`:
  - `slashMenuEntries` restituisce anche `category` (default `"builtin"`);
  - alias skill → `skill`; markdown → `command`; prompt MCP → `mcp`.
- `packages/cli/src/ui/commands/markdown.ts` e `mcp-prompts.ts`: impostare la
  categoria.
- `packages/cli/src/ui/components/SlashMenu.tsx`:
  - riga dedicata: `/` in `theme.primary`, nome con il match in bold/accent,
    descrizione in `theme.muted`, badge categoria colorato;
  - `query` passata da App per calcolare l'highlight;
  - larghezza descrizione calcolata dallo spazio reale.
- `packages/cli/src/ui/App.tsx`: passare `query={input.slice(1)}`.

**Comportamento**

- Il pezzo digitato è evidenziato nel nome.
- Un punto/badge distingue built-in, skill, comando markdown e prompt MCP.
- La descrizione si tronca senza andare a capo.

**Test**

- `registry.test.ts`: categorie corrette per alias/extras.
- `bottom-chrome.test.tsx`: il match è evidenziato (posizioni), il badge compare
  e la descrizione lunga viene troncata.

**Commit**

```text
feat(ui): color and annotate slash menu entries
```

---

### T3 — Attività: verbi contestuali e retry

**Scope**

- Nuovo `packages/cli/src/ui/lib/activity.ts`:
  - `activityVerbForTool(name): string` — mappa `read_file` → `Reading`,
    `grep`/`glob` → `Searching`, `edit_file`/`write_file`/`apply_patch` →
    `Editing`, `exec` → `Running`, `verify` → `Checking`, `spawn_agent` →
    `Delegating`, ecc.;
  - `thinkingSynonym(elapsedSeconds): string` — ruota ogni 10s;
  - `activityTitle(input): string` — applica la precedenza della sezione
    "Attività".
- `packages/cli/src/ui/hooks/useTurnRunner.ts`: esporre `retry` come stato
  (`{ attempt, maxAttempts } | null`), impostato su `onRetry` e azzerato su
  testo/tool/fine turno; il transcript continua a mostrare l'item "Provider
  Retry".
- `packages/cli/src/ui/components/ActivityIndicator.tsx`: fase `retrying`,
  verbo da `activityTitle`, sinonimi per il thinking.
- `packages/cli/src/ui/App.tsx`: passare tool, retry, streaming e reasoning;
  niente dettaglio duplicato quando il verbo è già quello del tool.

**Comportamento**

- `Reading src/foo.ts`, `Searching "TODO"`, `Running npm test`, `Retrying… (2/3)`,
  `Summarizing…`, `Pondering…` dopo 10s di attesa.
- Il dettaglio del tool resta visibile e troncato alla larghezza.

**Test**

- `activity.test.ts`: mapping tool → verbo, precedenza, sinonimi deterministici.
- `bottom-chrome.test.tsx`: `ActivityIndicator` mostra il verbo e il dettaglio.

**Commit**

```text
feat(ui): vary the activity indicator by context
```

---

### T4 — Footer: coda e stato MCP

**Scope**

- `packages/cli/src/ui/components/StatusFooter.tsx`: nuove prop opzionali
  `queued?: number` e `mcp?: { connected: number; total: number; pending: boolean }`.
- `packages/cli/src/ui/App.tsx`: calcolare i valori da `queuedPrompts`,
  `mcpConfig` e `mcpManager.status()`/`mcpReady`.
- Mostrare:
  - `+2 queued` in `theme.muted` quando c'è coda;
  - `mcp 2/3` in `theme.subtle`, o `mcp connecting…` finché `mcpReady` non
    risolve.

**Test**

- `bottom-chrome.test.tsx`: footer con coda e MCP, e senza (nessun rumore).

**Commit**

```text
feat(ui): show queue and MCP status in the footer
```

---

### T5 — Menu: fuzzy matching e recenti

**Scope**

- Nuovo `packages/cli/src/ui/lib/fuzzy.ts`:
  - `fuzzyScore(query, target)` con precedenza a exact, prefix, poi
    sotto-sequenza; `-1` se non matcha;
  - `filterCommands(entries, query, recent)` che ordina recenti → punteggio →
    ordine originale e restituisce le posizioni del match per l'highlight.
- `packages/cli/src/ui/App.tsx`:
  - usare `filterCommands` invece di `startsWith`;
  - `recentCommands` in stato di sessione, aggiornato dopo ogni dispatch
    riuscito (max 5, senza duplicati).
- `registry.ts`: `slashMenuEntries` resta la sorgente; il filtro vive in `lib/`.

**Comportamento**

- `/mdl` trova `/model`; `/mcp` resta prima di `/model` quando il punteggio è
  uguale all'ordine del registro.
- Gli ultimi comandi usati salgono in cima.

**Test**

- `fuzzy.test.ts`: exact/prefix/subsequence, nessun match, ordinamento con
  recenti, posizioni di highlight.
- `registry.test.ts`: invariato.

**Commit**

```text
feat(ui): fuzzy-match slash commands and remember recent ones
```

---

### T6 — Completamento argomenti

**Scope**

- Nuovo `packages/cli/src/ui/lib/completions.ts`:
  - `argumentCompletions(input, context)` con provider per:
    - `/theme ` → temi;
    - `/model ` → modelli disponibili per il provider;
    - `/provider ` → provider id;
    - `/skill use|enable|disable|remove ` → skill installate;
    - `/mcp show|inspect|login|logout|remove ` → server configurati;
    - nessun provider → nessun completamento.
  - `Completion = { value, description?, replaceFrom }`.
- `packages/cli/src/ui/components/CompletionMenu.tsx` (o riuso di `SlashMenu`
  con una modalità): lista con selezione, hint e scroll.
- `packages/cli/src/ui/App.tsx`:
  - calcolare i completamenti quando l'input contiene uno spazio;
  - `↑/↓`, `Tab`, `Invio` inseriscono il valore selezionato;
  - `Esc` chiude il menu dei completamenti;
  - precedenza: completamento argomenti → menu comandi.

**Comportamento**

- `/theme ` mostra i temi; `/skill use ` mostra le skill abilitate;
  `/mcp inspect ` mostra i server.
- Selezionare un valore sostituisce solo l'ultimo token, non tutta la riga.

**Test**

- `completions.test.ts`: provider, filtro per prefisso, `replaceFrom`.
- `bottom-chrome.test.tsx`: il menu completamenti renderizza valore e
  descrizione.

**Commit**

```text
feat(ui): complete command arguments
```

---

### T7 — Ghost text inline

**Scope**

- `packages/cli/src/ui/components/ChatInput.tsx`: prop `ghost?: string`, mostrata
  in `theme.muted` dopo il valore (solo quando il cursore è a fine riga).
- `packages/cli/src/ui/App.tsx`: calcolare il ghost dal comando selezionato
  quando l'input è un prefisso senza spazi
  (`/mo` + selezione `/model` → `del` in grigio).

**Comportamento**

- Fish-style: il resto del comando è visibile prima di premere Tab/Invio.
- Nessun ghost con input multi-riga, con argomenti o con il menu chiuso.

**Test**

- `bottom-chrome.test.tsx` o un test dedicato di `ChatInput`: ghost presente e
  assente; il testo digitato resta invariato.

**Commit**

```text
feat(ui): preview the selected completion inline
```

---

### T8 — Docs: README e /keys

**Scope**

- `README.md`: sezione TUI con tasti del menu, fuzzy, completamenti, ghost text,
  verbi di attività, coda e MCP nel footer.
- `packages/cli/src/ui/lib/shortcuts.ts`: aggiungere `tab`, `enter`, `esc` e
  `↑/↓` del menu; `SHORTCUT_HINT` aggiornato se serve.
- `TUI_TASKLIST.md`: stato finale.

**Test**

- `shortcuts` (se testato) e `npm run typecheck/test/build`.

**Commit**

```text
docs: document the TUI improvements
```

---

## Note di sicurezza e comportamento

- Il menu non esegue mai un comando che non sia stato selezionato esplicitamente.
- Il completamento argomenti inserisce solo valori noti (temi, modelli, server,
  skill); nessuna esecuzione.
- I comandi recenti sono di sessione: non finiscono in `config.json`.
- Nessun cambio ai formati di config o ai comandi esistenti; `Invio` che esegue
  il comando selezionato è l'unico cambio di semantica visibile, ed è
  documentato in README e `/keys`.

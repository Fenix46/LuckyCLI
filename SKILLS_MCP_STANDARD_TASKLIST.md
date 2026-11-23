# Skill e MCP standard — piano di lavoro

Obiettivo: rendere le skill e i server MCP di LuckyCLI **compatibili con gli
standard di fatto** usati dall'ecosistema (Agent Skills / `SKILL.md`, `.mcp.json`,
registry MCP ufficiale), mantenendo LuckyCLI come prodotto autonomo con le
**proprie root canoniche**. L'import da altri client (Claude Code, Claude
Desktop, Cursor) è un'interoperabilità esplicita, non la base del sistema.

Fuori scope di questa iterazione: plugin/marketplace, comandi e agenti in
markdown, hook dei plugin, LSP dei plugin. Sono elencati in fondo come lavori
successivi, non implementati qui.

- Branch: `feat/standard-skills-mcp`
- Base: `main` @ `0.8.0`
- Regole: `AGENTS.md` (nessuna dipendenza nuova, niente `any`, core
  provider-agnostico, test offline, un commit per task, footer di commit).

---

## 1. Decisioni di progetto

### 1.1 Root delle skill

LuckyCLI ha root **canoniche** (dove installa e dove scrive) e root di
**compatibilità** (sola lettura). L'ordine sotto è anche l'ordine di precedenza:
a parità di nome vince la prima root.

| Ambito | Root canonica (scrittura) | Root di compatibilità (lettura) |
|---|---|---|
| Globale | `~/.luckycli/skills/<name>/SKILL.md` | `~/.agents/skills/<name>/SKILL.md` · `~/.claude/skills/<name>/SKILL.md` |
| Progetto | `<cwd>/.lucky/skills/<name>/SKILL.md` | `<cwd>/.agents/skills/<name>/SKILL.md` · `<cwd>/.claude/skills/<name>/SKILL.md` |

Regole:

- **Le installazioni vanno sempre nella root canonica.** Un `install` che parte
  da una skill già presente in una root di compatibilità la copia nella root
  lucky, senza toccare l'originale.
- **Le root di compatibilità sono read-only.** `uninstall` non cancella mai
  nulla fuori da `~/.luckycli/skills`; per una skill di compatibilità propone
  `disable`.
- **Disable per nome, non per path.** `disabled.json` resta in
  `~/.luckycli/skills/graph/disabled.json`, così vale per tutte le root.
- I symlink sono seguiti (i progetti gestiti da `npx skills` creano
  `.agents/skills` + symlink in `.claude/skills`).
- Il nome è normalizzato (`lowercase`, spazi collassati) e la shadowing avviene
  per nome normalizzato.

### 1.2 Configurazione MCP

- La configurazione **lucky** resta: `~/.luckycli/config.json` → `mcp` per
  l'utente, `.mcp.json` di progetto e `.lucky/config.json` per il progetto
  (quest'ultimi solo in cartella trusted).
- **Import esplicito e spento.** I server trovati in altri client vengono
  importati con `enabled: false`; nessun processo di terzi parte
  automaticamente. Si abilitano dal pannello `/mcp` o con `--enable`.
- **Expansion delle variabili** in `command`, `args`, `env`, `url`, `headers`:
  `${VAR}` e `${VAR:-default}`. Variabile non impostata e senza default → stringa
  vuota (comportamento documentato).
- **Forme accettate** di `.mcp.json`: `{ "mcpServers": { ... } }` e la mappa
  nuda `{ "name": { ... } }` usata dai plugin; `type` può essere assente,
  `"stdio"`, `"http"`, `"sse"`, `"streamable-http"`.
- Endpoint non supportati oggi (es. `websocket`) restano fuori: vengono ignorati
  con un errore chiaro al load, non silenziosamente.

### 1.3 Formato skill

- Canonico: cartella con `SKILL.md` (lucky continua ad accettare `skill.md`),
  frontmatter `name` + `description`, corpo operativo, asset relativi alla
  cartella (`references/`, `scripts/`, …).
- I campi extra (`license`, `allowed-tools`, `metadata`, `version`, …) sono
  accettati e ignorati, salvo i due campi lucky `keywords` e `related`.
- Il parser deve accettare il sottoinsieme YAML che si trova davvero nei repo
  pubblici: scalari quotati, blocchi `>`/`|`, liste inline e a blocchi, mappe
  annidate ignorate, **scalari quotati su più righe** e escape `''`.

---

## 2. Regole di esecuzione

Prima di ogni commit, nell'ordine:

```bash
git diff
git status
npm run typecheck
npm test
npm run build
git diff --cached --stat
```

Se un passo fallisce, correggere la causa e ripartire. Non includere `dist/`,
`node_modules/`, `.lucky/` o file temporanei. Footer obbligatorio:

```text
Co-Authored-By: <model> <noreply@anthropic.com>
```

I test nuovi devono girare **offline**: per le sorgenti git si usa un repository
locale creato in una directory temporanea, oppure si inietta un `clone`
fake. Nessun test tocca la home reale dell'utente: le API accettano `root`,
`home` e `cwd` iniettabili.

---

## 3. Task

Panoramica:

| Task | Area | Commit |
|---|---|---|
| T0 | Docs: questo piano | `docs: plan standard skills and MCP compatibility` |
| T1 | Skill: root standard + precedenza | `feat(skills): read the standard skill roots` |
| T2 | Skill: parser frontmatter reale | `fix(skills): parse multi-line quoted frontmatter` |
| T3 | Skill: path tilde/assoluti | `fix(skills): expand ~ in skill install paths` |
| T4 | Skill: install da git/URL | `feat(skills): install skills from a git source` |
| T5 | CLI: comandi skill headless | `feat(cli): add headless skill commands` |
| T6 | Skill: uninstall solo nella root lucky | `fix(skills): keep uninstall inside the lucky root` |
| T7 | MCP: expansion variabili | `feat(mcp): expand environment variables in server config` |
| T8 | MCP: lettura config altri client | `feat(mcp): read MCP servers from other clients` |
| T9 | MCP: import esplicito spento | `feat(mcp): import servers from other clients disabled` |
| T10 | MCP: forme `.mcp.json` | `feat(mcp): accept bare and typed .mcp.json shapes` |
| T11 | CLI: `mcp add-json` | `feat(cli): add mcp add-json` |
| T12 | Docs: README + riferimenti | `docs: document standard skills and MCP support` |

---

### T0 — Documentazione del piano

**Stato:** fatto con questo file.

**Scope**

- `SKILLS_MCP_STANDARD_TASKLIST.md`: decisioni, task, test, commit.
- Nessuna modifica al codice.

**Done when**

- Ogni task ha scope, comportamento, test e commit definiti.
- Le scelte di root, precedenza e import sono esplicite.

**Commit**

```text
docs: plan standard skills and MCP compatibility
```

---

### T1 — Skill: root standard e precedenza

**Scope**

- `packages/core/src/skills/available.ts`:
  - separare root canoniche e root di compatibilità;
  - `projectSkillRoots(cwd)` → `[.lucky/skills, .agents/skills, .claude/skills]`;
  - nuova `globalSkillRoots()` → `[~/.luckycli/skills, ~/.agents/skills,
    ~/.claude/skills]`;
  - `listAvailableSkills(cwd, globalRoot?)` mantiene il parametro per i test, ma
    di default usa tutte le root globali;
  - `AvailableSkill` espone `scope: "project" | "global"` e `origin:
    "lucky" | "agents" | "claude"` (additivo) per la UI;
  - precedenza: progetto lucky → progetto .agents → progetto .claude → globale
    lucky → globale .agents → globale .claude.
- `packages/core/src/index.ts`: export dei nuovi helper.
- `packages/cli/src/ui/commands/skill.ts`: `/skill list` usa
  `listAvailableSkills` (mostra anche le root di compatibilità) invece del solo
  `discoverSkills`.
- README: tabella delle root aggiornata (parte della T12; qui solo il commento
  nel codice se serve).

**Comportamento**

- Con REA installato solo in `~/.agents/skills`, `skill_search`/`skill_load` e
  `/<skill>` lo vedono senza copiarlo.
- Un progetto con `.agents/skills` + symlink `.claude/skills` funziona già, e
  ora anche senza i symlink.
- Una skill lucky con lo stesso nome shadowa quella di compatibilità.

**Test**

- `packages/core/src/skills/available.test.ts` (nuovo):
  - root di progetto lette nell'ordine giusto;
  - root globali lette nell'ordine giusto;
  - shadowing per nome normalizzato;
  - symlink seguiti;
  - `globalRoot` esplicito limita la ricerca (retrocompatibile coi test
    esistenti).
- Test esistenti di `install`, `graph`, `activator` restano verdi.

**Done when**

- `listAvailableSkills` trova le skill in tutte le root standard.
- Nessuna scrittura fuori dalle root canoniche.

**Commit**

```text
feat(skills): read the standard skill roots
```

---

### T2 — Skill: parser frontmatter reale

**Scope**

- `packages/core/src/skills/skill-file.ts`:
  - gestire `key:` seguito da uno scalare quotato indentato su più righe
    (`description:` + `"..."` su righe successive), sia `"` che `'`;
  - gestire l'escape YAML `''` dentro gli scalari single-quoted;
  - mantenere il comportamento attuale per blocchi `>`/`|`, liste e mappe
    annidate ignorate.

**Comportamento**

- Il caso reale `math-olympiad` (description double-quoted multi-riga) parsa.
- Nessuna rottura dei file già accettati.

**Test**

- `packages/core/src/skills/skill-file.test.ts`:
  - description double-quoted multi-riga;
  - single-quoted con `''`;
  - blocco `>` che continua a funzionare;
  - mappa annidata ignorata;
  - errore chiaro se la description resta vuota.
- Eseguire il parser su un fixture che replica il file `math-olympiad`.

**Done when**

- I 153 `SKILL.md` reali usati per l'analisi passano (verifica manuale con uno
  script una tantum, non un test che dipende dalla home).

**Commit**

```text
fix(skills): parse multi-line quoted frontmatter
```

---

### T3 — Skill: path tilde e assoluti

**Scope**

- `packages/core/src/skills/install.ts`:
  - espandere `~` e `~/...` in `resolveSkillSource`;
  - normalizzare il path con `path.resolve` prima di `stat`;
  - messaggio d'errore che mostra il path risolto.
- `packages/cli/src/ui/commands/skill.ts`: il rilevamento "path-like" resta, ma
  non tratta più `owner/repo` come path locale (il riconoscimento vero arriva
  con T4; qui si aggiunge solo l'espansione di `~`).

**Test**

- `packages/core/src/skills/install.test.ts`:
  - `~/...` funziona con una home finta iniettata (aggiungere `home` alle
    opzioni o testare `expandHome` esportata);
  - path assoluto e relativo funzionano;
  - path inesistente → errore che cita il path risolto.

**Done when**

- `/skill add ~/.agents/skills/reverse-engineer-anything` installa nella root
  lucky.

**Commit**

```text
fix(skills): expand ~ in skill install paths
```

---

### T4 — Skill: install da git/URL

**Scope**

- Nuovo `packages/core/src/skills/source.ts`:
  - `parseSkillSource(spec)`:
    - path locale se esiste su disco o inizia con `.`/`/`/`~`;
    - URL git se contiene `://` o inizia con `git@`;
    - altrimenti `owner/repo` → `https://github.com/owner/repo.git`.
  - `findSkillDirs(root, { maxDepth = 4 })`: cerca cartelle con `SKILL.md` /
    `skill.md`, saltando `.git`, `node_modules`, `dist`, `build`;
  - `materializeSkillSource(source, options)`: per git, clone shallow
    (`git clone --depth 1 --single-branch [--branch <ref>]`) in una directory
    temporanea, con timeout e `GIT_TERMINAL_PROMPT=0`; cleanup garantito in
    `finally`;
  - `installSkillFromSource(spec, { skill?, all?, overwrite?, root? })`:
    - una sola skill trovata → installa;
    - più skill e nessuna selezione → errore che elenca nome e path relativo;
    - `skill` seleziona per nome normalizzato; `all` installa tutte;
    - ogni install passa da `installSkillFromPath` (stessi controlli, stessa
      copia degli asset);
  - il clone è iniettabile (`clone?: (url, dest, ref?) => Promise<void>`) per i
    test.
- `packages/core/src/index.ts`: export delle nuove API.
- Nessuna nuova dipendenza: si usa `git`, già requisito del progetto; se `git`
  manca, errore esplicito.

**Sicurezza**

- Non si esegue nulla del repository (niente `npm install`, niente script).
- Clone solo shallow, timeout, cleanup.
- `--depth 1` e nessun checkout di submodule (`--no-recurse-submodules`).
- Dimensione non illimitata: se il clone supera il timeout, errore e cleanup.

**Test**

- `packages/core/src/skills/source.test.ts`:
  - parsing di `owner/repo`, URL https, `git@`, path locale, path inesistente;
  - `findSkillDirs` su un albero finto con più skill e cartelle da ignorare;
  - repository git locale creato in temp con due skill: `all` installa entrambe,
    selezione singola installa una, collisione senza `overwrite` fallisce;
  - clone fake che lancia → cleanup della directory temporanea.

**Done when**

- `lucky skill add owner/repo` (T5) installa la skill giusta, con `references/`.
- Errori chiari per repo senza skill, più skill senza selezione, git assente.

**Commit**

```text
feat(skills): install skills from a git source
```

---

### T5 — CLI: comandi skill headless

**Scope**

- Nuovo `packages/cli/src/skill-cli.ts`, sul modello di `mcp-cli.ts`:
  - `lucky skill list` — nome, scope, origine, stato;
  - `lucky skill search <query>` — catalogo (come `/skill search`);
  - `lucky skill add <path|owner/repo|url>` — `--skill <name>`, `--all`,
    `--overwrite`, `--ref <ref>`;
  - `lucky skill remove <name>`;
  - `lucky skill enable|disable <name>`;
  - `lucky skill import <path>` — copia una skill da una root di compatibilità
    nella root lucky (utile per script/CI).
- `packages/cli/src/index.tsx`: dispatch di `skill`, help aggiornato.
- `packages/cli/src/ui/commands/skill.ts`: `/skill add owner/repo` usa
  `installSkillFromSource` e, se ci sono più skill, mostra l'elenco con il
  suggerimento `--skill`.
- Le dipendenze sono iniettabili (`SkillCommandIO`), come per MCP.

**Test**

- `packages/cli/src/skill-cli.test.ts`:
  - `list` con root finte;
  - `add` da path locale;
  - `add` da repo con più skill → exit 1 e messaggio con i nomi;
  - `remove`, `enable`, `disable`;
  - `import` copia nella root canonica.

**Done when**

- Le stesse operazioni del pannello sono disponibili senza TUI, con exit code
  corretti.

**Commit**

```text
feat(cli): add headless skill commands
```

---

### T6 — Skill: uninstall solo nella root lucky

**Scope**

- `packages/core/src/skills/install.ts`:
  - `uninstallSkill` controlla che la skill sia nella root canonica; se esiste
    solo in una root di compatibilità restituisce un errore esplicito
    (`installed outside the lucky skills root; use disable`);
  - `setSkillEnabled` continua a funzionare per nome su tutte le root.
- `packages/cli/src/ui/commands/skill.ts`: messaggio d'errore dedicato per
  `remove` su skill di compatibilità.

**Test**

- `packages/core/src/skills/install.test.ts`:
  - skill in `~/.agents/skills` → `uninstall` non cancella e spiega;
  - skill nella root lucky → `uninstall` cancella;
  - `disable` su skill di compatibilità funziona.

**Done when**

- Nessun comando lucky può cancellare file in `~/.claude/skills` o
  `~/.agents/skills`.

**Commit**

```text
fix(skills): keep uninstall inside the lucky root
```

---

### T7 — MCP: expansion delle variabili

**Scope**

- Nuovo `packages/core/src/mcp/expand.ts`:
  - `expandEnvString(value, env)`: `${VAR}` e `${VAR:-default}`; `$VAR` non
    supportato (documentato);
  - `expandMcpServerConfig(config, env)`: applica a `command[]`, `environment`
    values, `url`, `headers` values.
- `packages/core/src/config/config.ts`: applicare l'expansion alla mappa `mcp`
  risolta (dopo il merge globale/progetto).
- Nessuna espansione al momento della scrittura: `config.json` e `.mcp.json`
  restano con i placeholder.

**Test**

- `packages/core/src/mcp/expand.test.ts`:
  - `${VAR}` impostata;
  - `${VAR:-default}` con variabile assente e presente;
  - variabile assente senza default → stringa vuota;
  - espansione in command, args, env, url, headers;
  - un valore senza placeholder resta identico.
- `packages/core/src/config/config.test.ts`: `resolveConfig().mcp` espande.

**Done when**

- Un `.mcp.json` nella forma usata dai plugin (es. `TFE_TOKEN=${TFE_TOKEN}`)
  funziona.

**Commit**

```text
feat(mcp): expand environment variables in server config
```

---

### T8 — MCP: lettura config altri client

**Scope**

- Nuovo `packages/core/src/mcp/import.ts`:
  - `readClaudeUserMcp(home)` → `~/.claude.json` → `mcpServers`;
  - `readClaudeProjectMcp(home, cwd)` → `projects[cwd].mcpServers` (scope
    locale di Claude Code);
  - `readClaudeDesktopMcp(home)` →
    `~/Library/Application Support/Claude/claude_desktop_config.json`
    (macOS) e `%APPDATA%/Claude/claude_desktop_config.json` (Windows);
  - `readCursorMcp(home)` → `~/.cursor/mcp.json`;
  - `collectImportableServers({ home, cwd })` → elenco
    `{ name, config, origin }`, deduplicato per nome, con l'origine;
  - usa `fromMcpJsonEntry` per la conversione, quindi niente parser duplicati.
- Tutte le funzioni sono **read-only** e non lanciano se un file manca o è
  corrotto (quel client viene saltato).

**Test**

- `packages/core/src/mcp/import.test.ts`, con una home finta in temp:
  - `~/.claude.json` utente + progetto;
  - `claude_desktop_config.json`;
  - `~/.cursor/mcp.json`;
  - file corrotto → sorgente saltata;
  - deduplica con origine stabile.

**Done when**

- I server configurati per gli altri client sono leggibili senza side effect.

**Commit**

```text
feat(mcp): read MCP servers from other clients
```

---

### T9 — MCP: import esplicito e spento

**Scope**

- `packages/cli/src/mcp-cli.ts` e `packages/cli/src/ui/commands/mcp.ts`:
  - `lucky mcp import [--from claude|claude-desktop|cursor|all] [--dry-run]
    [--enable] [--force]`;
  - default `all`; scrive in `~/.luckycli/config.json` con `enabled: false`
    (salvo `--enable`);
  - non sovrascrive un server già presente senza `--force`;
  - stampa origine, tipo e comando/URL di ciò che importa;
  - `/mcp import` in TUI usa la stessa funzione e aggiorna la config viva.
- `packages/core/src/mcp/types.ts`: campo additivo opzionale
  `importedFrom?: "claude" | "claude-desktop" | "cursor"` (persistito, ignorato
  dalla connessione).
- `packages/cli/src/index.tsx`: help aggiornato.

**Test**

- `packages/cli/src/mcp-cli.test.ts`:
  - import da una home finta con due server → config con `enabled: false`;
  - `--dry-run` non scrive;
  - `--enable` scrive abilitato;
  - collisione senza `--force` salta e lo dice;
  - `--from` sconosciuto → exit 1.
- `/mcp import` testato con deps iniettate.

**Done when**

- Dopo l'import, `lucky mcp list` mostra i server come `disabled`; nessun
  processo parte finché non vengono abilitati.

**Commit**

```text
feat(mcp): import servers from other clients disabled
```

---

### T10 — MCP: forme `.mcp.json`

**Scope**

- `packages/core/src/mcp/config.ts`:
  - `loadProjectMcpJson` accetta `{ "mcpServers": { ... } }` e la mappa nuda;
  - `fromMcpJsonEntry` accetta `type` assente/`stdio`/`http`/`sse`
    /`streamable-http`;
  - `type` sconosciuto → entry ignorata (comportamento attuale) con test
    esplicito.
- `packages/core/src/mcp/types.ts`: nessun cambio di shape pubblico; `type`
  lucky resta `"local" | "remote"`.

**Test**

- `packages/core/src/mcp/config.test.ts`:
  - wrapper e mappa nuda;
  - `type: "stdio"` con `command` string;
  - `type: "http"`/`"sse"` con `url` e `headers`;
  - `disabled: true` → `enabled: false`;
  - entry invalida ignorata.

**Done when**

- Un `.mcp.json` di plugin (mappa nuda) e uno di progetto (wrapper) si leggono
  allo stesso modo.

**Commit**

```text
feat(mcp): accept bare and typed .mcp.json shapes
```

---

### T11 — CLI: `mcp add-json`

**Scope**

- `packages/cli/src/mcp-cli.ts`:
  - `lucky mcp add-json <name> '<json>'`;
  - `lucky mcp add-json <name> --file <path>` e `--file -` per stdin;
  - il JSON è la entry di un server (stessa forma di `.mcp.json`);
  - errori chiari per JSON invalido o entry non riconosciuta.
- `packages/core/src/mcp/config.ts`: `parseMcpJsonEntryArgs` (puro, testabile).
- `packages/cli/src/index.tsx`: help aggiornato.

**Test**

- `packages/core/src/mcp/config.test.ts`: parsing argomenti e JSON.
- `packages/cli/src/mcp-cli.test.ts`: add-json scrive la config; JSON invalido
  → exit 1.

**Done when**

- Si può incollare la config di un server dalla documentazione senza riscriverla
  a mano.

**Commit**

```text
feat(cli): add mcp add-json
```

---

### T12 — Docs: README e riferimenti

**Scope**

- `README.md`:
  - tabella root skill (canoniche vs compatibilità) e precedenza;
  - `lucky skill ...` e `/skill add owner/repo`;
  - import MCP esplicito/spento, expansion variabili, forme `.mcp.json`;
  - nota su cosa non è supportato (plugin, websocket, `$VAR`).
- `SKILLS_MCP_STANDARD_TASKLIST.md`: stato finale dei task.
- Nessun cambio di codice.

**Test**

- `npm run typecheck`, `npm test`, `npm run build` verdi (docs-only, ma la
  sequenza si esegue comunque).

**Commit**

```text
docs: document standard skills and MCP support
```

---

## 4. Lavori successivi (fuori da questa iterazione)

Nell'ordine in cui ha senso affrontarli, dopo T0–T12:

1. **Config MCP di altri client ancora mancanti**: `.vscode/mcp.json`
   (`servers`, `type: stdio|http`), `~/.codex/config.toml` (richiede un parser
   TOML: dipendenza da approvare o parser minimo dedicato), Windsurf.
2. **Plugin skills-only**: `.claude-plugin/plugin.json` +
   `marketplace.json`, sorgenti `github`/`git-subdir`/`url`/`path`, cache
   gestita, comando `lucky plugin marketplace add`. Sblocca le skill dei plugin
   senza implementare comandi/agenti/hook.
3. **Plugin completi**: `commands/*.md` con `$ARGUMENTS`, `agents/*.md` →
   profili lucky (mapping tool `Read`/`Write`/`Bash` → `read_file`/…),
   `hooks/hooks.json` con `${CLAUDE_PLUGIN_ROOT}`, `.mcp.json` bundled,
   `lspServers`. È un progetto a sé, con modello di trust.
4. **`skills-lock.json`**: leggere/scrivere il lockfile dello standard
   `npx skills` per provenance e update riproducibili.
5. **Budget del listing**: allineare il numero di skill elencate e la lunghezza
   delle description a un budget (oggi 40 skill / 160 caratteri), invece del
   troncamento fisso.
6. **`allowed-tools`**: valutare l'enforcement delle restrizioni di tool
   dichiarate nel frontmatter (oggi ignorate).
7. **Catalogo skill**: sostituire/affiancare il catalogo lucky con un indice
   standard (repo GitHub/agentskills) così `lucky skill search` trova le skill
   pubbliche senza un servizio dedicato.

---

## 5. Nota

L'analisi di Claude Code in `Documents/reverse/claude-code-re` descrive il
comportamento di riferimento (root, manifest, plugin, import). Questo piano
reimplementa i pattern nello stile LuckyCLI: TypeScript ESM, zod, core
provider-agnostico, test offline. Nessun codice di Claude Code viene copiato.

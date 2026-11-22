# LuckyCLI × Claude Code — piano di adattamento

Analisi statica di LuckyCLI 0.7.1 (`packages/core` + `packages/cli`) e confronto con
Claude Code 2.1.330 estratto dal binario Bun. Obiettivo: portare **pattern e
comportamenti**, non copiare codice. Le implementazioni restano nello stile
LuckyCLI (TypeScript ESM, zod, core provider-agnostico, test Vitest).

## Cosa LuckyCLI ha già

- Agent loop provider-agnostico con streaming, tool call, retry transienti,
  fallback, abort, compaction e pruning dei tool result.
- Tool built-in: `read_file`, `write_file`, `edit_file`, `apply_patch`, `exec`,
  `process`, `PowerShell`, `list_dir`, `glob`, `grep`, `http_fetch`,
  `task_*`, `present_plan`, `spawn_agent`, `project_memory`, `graph_*`,
  `skill_*`, `ask_user`, `verify`.
- Permessi per tool + regole per comando, modalità `normal`/`acceptEdits`/`auto`,
  approvazioni “always” con scope, preview diff.
- Knowledge graph nativo con estrazione multi-linguaggio e aggiornamento
  incrementale.
- MCP locale/remoto, OAuth, catalogo, prompt/risorse nel core; pannello `/mcp`.
- Skill loader, agenti custom, task store, checkpoint/restore, review diff,
  verifica progetto, ACP, sessioni persistenti, update self-replace.
- Test suite ampia (1.421 test) e typecheck pulito.

## Gap rispetto a Claude Code

| Area | Claude Code | LuckyCLI | Priorità |
|---|---|---|---|
| Lettura prima della modifica | `Edit`/`Write` richiedono una `Read` e verificano che il file non sia cambiato | solo istruzione nel prompt | **alta** |
| Output lunghi dei tool | output completo salvato su file, path nel risultato | troncamento head/tail, nessun file | **alta** |
| Plan mode | modalità read-only enforced; i tool mutanti sono bloccati finché il piano non è approvato | flusso `present_plan` presente, ma non enforced | **alta** |
| Hook lifecycle | 33 eventi, hook command/prompt/agent/http/mcp_tool | assenti | media |
| LSP | tool `LSP` con diagnosi, hover, definition, references | assente | media |
| Web search | tool `WebSearch` | assente (solo `http_fetch`) | media |
| Notebook | `NotebookEdit` | assente (volutamente rimandato) | bassa |
| Worktree | `EnterWorktree`/`ExitWorktree` | assente | bassa |
| Team/teammate | agenti in team, messaggistica, task condivisi | solo sub-agenti | bassa |
| Tool differiti | `ToolSearch` per scoprire tool su richiesta | assente | media |
| Hook/mod API | API TypeScript completa per plugin UI/engine | assente | bassa |
| Session branching | fork/branch della conversazione | resume, ma non fork | bassa |
| Cost tracking | usage/costo per turno e sessione | `usage-cost.ts` + `/usage` parziale | media |

## Cosa implementiamo in questa iterazione

### 1. File state ledger — read-before-edit enforced

Nuovo `packages/core/src/tools/file-state.ts`:

- registra l’hash del contenuto letto da `read_file` (per path assoluto);
- `edit_file`, `write_file` (overwrite) e `apply_patch` (update/delete) verificano
  che il file sia stato letto e che il contenuto non sia cambiato da allora;
- dopo una scrittura riuscita aggiornano lo stato, così edit consecutivi non
  richiedono una nuova lettura;
- `Agent` crea il ledger e lo passa a ogni tool; il pruning/compaction lo
  ripuliscono insieme al `ReadLedger`.

L’enforcement è attivo solo quando `ToolContext.fileState` è presente: l’agente
lo passa sempre, i test/callers che usano il registry direttamente mantengono il
comportamento precedente.

### 2. Persistenza degli output lunghi

Nuovo `packages/core/src/tools/output-store.ts`:

- quando `exec` produce più di 30.000 caratteri, l’output completo viene scritto
  in `.lucky/tool-results/<timestamp>-<tool>-<call>.txt` (0600);
- il risultato per il modello resta troncato head/tail ma aggiunge il path
  relativo e la dimensione, così può rileggere il resto con `read_file`;
- `metadata.persistedOutputPath` e `persistedOutputBytes` sono disponibili per
  la UI;
- `.lucky/` è già gitignored.

### 3. Plan mode enforced

- `AgentConfig.planMode` + `Agent.setPlanMode()`.
- In plan mode i tool non-readonly sono **deny**; `read_file`, `grep`, `glob`,
  `graph_*`, `http_fetch`, `ask_user`, `present_plan` restano disponibili.
- I comandi shell read-only (`git status`, `ls`, …) restano disponibili tramite
  il classificatore già esistente; i comandi mutanti/destructivi sono negati.
- Il system prompt della richiesta aggiunge una nota di plan mode (non
  persistita, per non sporcare la cache al resume).
- TUI: `PermissionMode` include `plan`, ciclo `normal → acceptEdits → auto →
  plan → normal`, badge nel footer; quando il piano viene accettato si torna a
  `normal` e `setPlanMode(false)`.
- ACP: modalità `plan` nella roster; `setSessionMode` chiama
  `agent.setPlanMode`; l’accettazione del piano torna a `default`.

## Roadmap successiva (non in questa iterazione)

1. **Hook lifecycle** minimale (`PreToolUse`, `PostToolUse`, `UserPromptSubmit`,
   `SessionStart`, `Stop`) con comandi shell, timeout e JSON su stdin.
2. **LSP** come tool read-only con lifecycle server gestito.
3. **Web search** con adapter configurabile (provider da decidere).
4. **Tool differiti** (`ToolSearch`) per non spedire tutti gli schema MCP.
5. **Session fork** e branch della conversazione.
6. **Team/teammate** sopra il task store e `spawn_agent`.
7. **Cost tracking** completo per turno/sessione con prezzi configurabili.

## Nota

Claude Code è codice proprietario di Anthropic. Questo lavoro usa il bundle solo
come riferimento di comportamento e priorità; le modifiche a LuckyCLI sono
riscritture originali nello stile del progetto. Non copiare prompt lunghi, UI o
implementazioni verbatim senza verifica di licenza.

# Browser bridge — native messaging (parità con Claude in Chrome)

Obiettivo: sostituire il bridge HTTP con porta + token con l'architettura usata
da Claude in Chrome, **precisa**:

```
Chrome
  └─ estensione Lucky (nativeMessaging)
       ↕  stdio, frame [uint32 LE][JSON]
  └─ native host "com.luckycli.browser_extension"
       ↕  Unix socket <tmp>/lucky-mcp-browser-bridge-<user>/<pid>.sock
  └─ Lucky (client MCP, unix socket)
       └─ tool MCP  mcp__lucky_browser__*
```

Riferimenti verificati sul campo:

- manifest di Claude:
  `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.anthropic.claude_code_browser_extension.json`
- wrapper: `~/.claude/chrome/chrome-native-host` → `exec claude --chrome-native-host`
- socket: `/tmp/claude-mcp-browser-bridge-<user>/<pid>.sock` (0600)
- protocollo nativo: `ping`/`pong`, `get_status`/`status_response`,
  `tool_request`, `tool_response`, `notification`, `mcp_connected`,
  `mcp_disconnected`
- il native host inoltra i messaggi MCP dei client (Claude Code) all'estensione;
  l'estensione è il vero MCP server.
- estensione: `nativeMessaging`, `<all_urls>`, `debugger`, `activeTab`,
  `scripting`, reconnect con alarm, badges.

Nessuna nuova dipendenza: solo `node:net`, `node:fs`, `node:crypto`.

- Branch: `feat/browser-native`
- Estensione: `../lucky-chrome-extension` (repo separato, branch dedicato)
- Regole: `AGENTS.md`; un commit per task; typecheck/test/build verdi.

---

## Decisioni

### Nomi

| Cosa | Valore |
|---|---|
| Native host | `com.luckycli.browser_extension` |
| Socket dir | `/tmp/lucky-mcp-browser-bridge-<username>` |
| Socket | `<dir>/<pid>.sock` |
| Wrapper | `~/.luckycli/chrome-native-host` |
| Server MCP (nome Lucky) | `lucky_browser` |
| Prefisso tool | `mcp__lucky_browser__` |
| Estensione | ID fisso via `key` |

ID estensione calcolato dalla chiave pubblica generata: `lcliakcldefkkiegbfchoifkconomego`.
La chiave pubblica va nel `manifest.json` (`key`); la privata resta fuori dal
repo (`~/.luckycli/browser-extension-key.pem`, 0600) per un eventuale `.crx`.

### Protocollo nativo (Chrome ↔ host)

Frame: `uint32 little-endian` + UTF-8 JSON. Massimo 1 MiB.

| Direzione | Messaggio |
|---|---|
| host → ext | `{type:"pong", timestamp}` |
| host → ext | `{type:"status_response", native_host_version, computer_name}` |
| host → ext | `{type:"tool_request", id, method, params}` |
| host → ext | `{type:"error", error}` |
| host → ext | `{type:"mcp_connected"}` / `{type:"mcp_disconnected"}` |
| ext → host | `{type:"ping"}` |
| ext → host | `{type:"get_status"}` |
| ext → host | `{type:"tool_response", id, result}` oppure `{..., error}` |
| ext → host | `{type:"notification", method, params}` |

L'host inoltra `tool_response`/`notification` ai client MCP togliendo `type`.

### Protocollo MCP (Lucky ↔ estensione)

L'estensione implementa:

- `initialize` → capabilities `{tools:{}}`, serverInfo `lucky-in-chrome`
- `tools/list` → i tool browser
- `tools/call` → esecuzione
- `ping` → `{}`

Tool iniziali (equivalenti alle azioni attuali):

| Tool | Azione |
|---|---|
| `tabs_list` | elenca le tab |
| `tabs_open` | apre un URL |
| `tabs_activate` | attiva una tab |
| `tabs_close` | chiude una tab |
| `page_snapshot` | titolo, URL, testo visibile |
| `page_click` | click su selettore CSS |
| `page_type` | scrive in un campo |

Tool di parità Claude (`computer`, `read_page`, `find`, `form_input`,
`navigate`, `browser_batch`, `upload_image`, `read_console_messages`,
`read_network_requests`, `javascript_tool`, …) sono la fase successiva: la
struttura MCP li accoglie senza cambiare il trasporto.

### Sicurezza

- `allowed_origins` contiene solo l'ID Lucky: nessun'altra estensione può
  avviare l'host.
- Socket in `/tmp/lucky-mcp-browser-bridge-<user>` (0700), file socket 0600.
- Stale socket rimossi solo se il PID non è vivo.
- L'host non esegue nulla: inoltra solo frame MCP.
- L'estensione richiede `<all_urls>` per `scripting.executeScript`; è il prezzo
  della parità con Claude. In alternativa `chrome.debugger` (fase successiva).
- Nessun token, nessuna porta HTTP, nessun CORS.

---

## Task

| Task | Area | Commit |
|---|---|---|
| T0 | Docs: questo piano | `docs: plan the native browser bridge` |
| T1 | Core: trasporto MCP su Unix socket | `feat(mcp): add a Unix socket transport` |
| T2 | Core: scoperta bridge + config `unix` | `feat(mcp): discover the browser bridge` |
| T3 | CLI: native host (`lucky browser host`) | `feat(browser): run the native messaging host` |
| T4 | CLI: install/status/uninstall | `feat(browser): install the native host` |
| T5 | Runtime: auto-connect + `/browser` status | `feat(browser): connect the bridge automatically` |
| T6 | Pulizia: rimuovere HTTP bridge e tool builtin | `refactor(browser): drop the HTTP bridge` |
| T7 | Estensione: native messaging + MCP server | `feat: connect Lucky through native messaging` |
| T8 | Docs: README e migrazione | `docs: document the native browser bridge` |

---

### T0 — Piano

**Scope:** questo file. Nessun codice.

**Commit:** `docs: plan the native browser bridge`

---

### T1 — Core: trasporto MCP su Unix socket

**Scope**

- `packages/core/src/mcp/unix-client.ts` (nuovo):
  - `UnixClientTransport implements Transport` del SDK MCP;
  - framing `uint32 LE` + JSON, max 1 MiB, buffer incrementale;
  - `start()` connette `net.connect(path)`, `send()` frame, `close()` chiude;
  - `onmessage`/`onerror`/`onclose` popolati.
- `packages/core/src/mcp/unix-client.ts`: `McpUnixClient` con la stessa
  superficie di `McpLocalClient` (`listTools`, `callTool`, prompt, resources).
- `packages/core/src/mcp/types.ts`: `McpUnixServerConfig { type:"unix"; path }`.
- `McpManager.connectServer` accetta `unix`.
- Export in `packages/core/src/index.ts`.

**Test**

- server `net` finto in temp dir: initialize/listTools/callTool;
- frame spezzati su più chunk e più frame in un chunk;
- frame oltre 1 MiB → errore e chiusura;
- socket inesistente → errore leggibile.

**Commit:** `feat(mcp): add a Unix socket transport`

---

### T2 — Core: scoperta del bridge browser

**Scope**

- `packages/core/src/browser-bridge.ts` (nuovo):
  - `browserBridgeDir(home?)` → `/tmp/lucky-mcp-browser-bridge-<user>`;
  - `listBrowserBridgeSockets()` → socket `.sock` con PID vivo;
  - `discoverBrowserBridge()` → primo socket utilizzabile (o `undefined`).
- `resolveConfig`/runtime non cambiano ancora: la scoperta è usata da T5.

**Test**

- directory finta, socket stale con PID morto ignorato;
- nessun socket → `undefined`;
- socket vivo trovato.

**Commit:** `feat(mcp): discover the browser bridge`

---

### T3 — CLI: native host

**Scope**

- `packages/cli/src/browser/native-host.ts` (nuovo):
  - legge frame da stdin, scrive frame su stdout, log su stderr;
  - server Unix socket con cleanup stale (PID), dir 0700, socket 0600;
  - `ping` → `pong`, `get_status` → `status_response`;
  - client MCP connesso → `mcp_connected`, e ogni frame MCP diventa
    `tool_request`;
  - `tool_response`/`notification` inoltrati ai client MCP;
  - chiusura pulita su EOF.
- `packages/cli/src/index.tsx`: comando nascosto `browser host`.
- `packages/cli/src/browser/frames.ts`: codec condiviso + test.

**Test**

- fake stdin/stdout: ping/pong, get_status, tool_request forwarding;
- fake client socket: tool_response arriva al client, `mcp_connected` parte;
- socket stale rimosso; chiusura rimuove socket e dir vuota.

**Commit:** `feat(browser): run the native messaging host`

---

### T4 — CLI: install/status/uninstall

**Scope**

- `packages/cli/src/browser/install.ts` (nuovo):
  - mappa browser macOS/Linux (Chrome, Brave, Arc, Edge, Chromium, Vivaldi,
    Opera), come Claude;
  - wrapper `~/.luckycli/chrome-native-host` (sh executable, exec del binario
    Lucky + `browser host`; in dev `node <entry> browser host`);
  - manifest `{name, description, path, type:"stdio", allowed_origins:[id]}`;
  - scrittura in `NativeMessagingHosts` di ogni browser rilevato;
  - `browser status`: manifest presenti, socket vivi, host in esecuzione;
  - `browser uninstall`: rimuove manifest e wrapper.
- `packages/cli/src/index.tsx`: comandi `browser install|status|uninstall`.
- ID estensione costante `EXTENSION_ID`.

**Test**

- percorsi per piattaforma (macOS/Linux) con home finta;
- manifest JSON corretto e `allowed_origins`;
- wrapper eseguibile con path quotati;
- uninstall rimuove solo i file scritti.

**Commit:** `feat(browser): install the native host`

---

### T5 — Runtime: auto-connect e `/browser`

**Scope**

- `packages/cli/src/runtime.ts`: alla costruzione, `discoverBrowserBridge()` e
  merge di un server `lucky_browser` (`type:"unix"`) nella mappa MCP, senza
  sovrascrivere un server omonimo configurato dall'utente.
- `packages/cli/src/ui/Root.tsx` / `App.tsx`: `/browser` mostra
  - host installato? (`browser status`)
  - socket trovato?
  - server MCP `lucky_browser` connesso e numero di tool.
- `BrowserBridge` HTTP non è più creato dalla TUI.

**Test**

- runtime con bridge fake → server MCP aggiunto;
- server omonimo utente → non sovrascritto;
- `/browser` output nei tre stati.

**Commit:** `feat(browser): connect the bridge automatically`

---

### T6 — Pulizia

**Scope**

- Rimuovere `packages/cli/src/browser/bridge.ts` + test, `~/.lucky/browser.json`.
- Rimuovere il tool builtin `browser` e le sue voci in registry/prompt/permessi;
  i tool browser ora arrivano da `mcp__lucky_browser__*`.
- Aggiornare i test che citano il tool.

**Commit:** `refactor(browser): drop the HTTP bridge`

---

### T7 — Estensione

Repo `../lucky-chrome-extension`:

- `manifest.json`:
  - `key` con la chiave pubblica → ID `lcliakcldefkkiegbfchoifkconomego`;
  - `permissions`: `tabs`, `scripting`, `alarms`, `nativeMessaging`;
  - `host_permissions`: `<all_urls>`;
  - `background` service worker; niente options con porta/token.
- `background.js`:
  - `connectNative("com.luckycli.browser_extension")` all'avvio;
  - `ping`/`pong`, `get_status`;
  - handler MCP: `initialize`, `tools/list`, `tools/call`, `ping`;
  - tool `tabs_list/open/activate/close`, `page_snapshot/click/type`;
  - `mcp_connected`/`mcp_disconnected` → badge;
  - reconnect su `onDisconnect`, `onStartup`, `onInstalled`, alarm 1 min;
  - niente polling HTTP, niente storage di porta/token.
- `options.html/js`: pagina di stato (host installato, bridge connesso, badge),
  senza campi porta/token.
- README aggiornato.

**Commit (repo estensione):** `feat: connect Lucky through native messaging`

---

### T8 — Documentazione

- `README.md`: setup `lucky browser install`, load unpacked, niente porta/token,
  permesso `<all_urls>`, stato `/browser`, nota che i tool sono MCP.
- `BROWSER_NATIVE_TASKLIST.md`: stato finale.
- `docs/editors.md` se cita il bridge HTTP.

**Commit:** `docs: document the native browser bridge`

---

## Fuori scope (fase successiva)

- Tool di parità Claude: `computer`, screenshot, `find`, `form_input`,
  `navigate`, `browser_batch`, `upload_image`, console/network, JS eval.
- `chrome.debugger` come trasporto alternativo (per screenshot e input a basso
  livello).
- Windows registry + wrapper `.cmd`.
- Firma `.crx` e distribuzione Web Store.

# Lucky Chrome extension

A Manifest V3 extension that lets the Lucky CLI use your own Chrome: list,
open, activate and close tabs, read the visible text of a page, click a CSS
selector and type into a field.

All traffic goes to a loopback bridge in the CLI (`127.0.0.1`) and is
authenticated with a bearer token. There is no cloud service, no native
messaging host and no remote code.

## Setup

1. Build and start Lucky from this repository (`npm run build`, then the CLI).
2. In Lucky, run `/browser`. It prints the bridge port and token and writes
   `~/.lucky/browser.json` (mode `0600`).
3. Open `chrome://extensions`, enable **Developer mode**, choose **Load
   unpacked**, and select this `packages/chrome-extension` directory.
4. Open the extension's **Options**, paste the port and token, **Save**, then
   **Check connection**.
5. Ask Lucky to use the browser, e.g. “open example.com and summarize the page”.

The bridge picks the first free port in `17321–17330`; the extension
reconnects on its own every minute and whenever the saved settings change.

## Commands

| Tool action | Bridge method | What it does |
| --- | --- | --- |
| `tabs` | `tabs.list` | List every tab (id, title, url, active, pinned) |
| `open` | `tabs.open` | Open a URL in a new active tab |
| `activate` | `tabs.activate` | Focus a tab and its window |
| `close` | `tabs.close` | Close a tab |
| `snapshot` | `page.snapshot` | Return the tab title, URL and visible text (20k chars) |
| `click` | `page.click` | Click the first element matching a CSS selector |
| `type` | `page.type` | Set a field's value and dispatch input/change; optionally submit |

Each request is permission-gated in Lucky (`ask` by default), so you approve
browser actions like any other tool.

## Security notes

- The server binds to `127.0.0.1` only and rejects requests without the token.
- The token is random (24 bytes, base64url) and stored in `~/.lucky/browser.json`.
- Page snippets are truncated before they reach the model.
- The extension never reads cookies, passwords or browser history.

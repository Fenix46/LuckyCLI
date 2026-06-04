/**
 * Loopback OAuth redirect server for the MCP authorization flow.
 *
 * The MCP SDK drives token exchange and refresh itself; all we need to capture
 * is the authorization `code` (and `state`) the provider redirects back with.
 * This listens on a localhost port and resolves once the redirect arrives.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const HTML_SUCCESS = `<!doctype html>
<html><head><title>LuckyCLI — MCP Authorization</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0d1117;color:#f0f6fc}.box{text-align:center;padding:2rem}h1{color:#58a6ff}p{color:#8b949e}</style>
</head><body><div class="box"><h1>Authorization complete</h1><p>You can close this window and return to LuckyCLI.</p></div><script>setTimeout(()=>window.close(),2000)</script></body></html>`;

function htmlError(message: string): string {
  return `<!doctype html>
<html><head><title>LuckyCLI — MCP Authorization Failed</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0d1117;color:#f0f6fc}.box{text-align:center;padding:2rem}h1{color:#f85149}.err{font-family:monospace;margin-top:1rem;padding:1rem;background:#161b22;color:#ffa657}</style>
</head><body><div class="box"><h1>Authorization failed</h1><div class="err">${message}</div></div></body></html>`;
}

export interface OAuthCallbackResult {
  code: string;
  state: string | null;
}

export interface OAuthCallbackServer {
  /** The redirect URI to register with the authorization server. */
  redirectUrl: string;
  /** Resolves when the browser hits the redirect with an authorization code. */
  waitForCode(timeoutMs?: number): Promise<OAuthCallbackResult>;
  close(): Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export async function startOAuthCallbackServer(
  options: { port?: number; path?: string } = {},
): Promise<OAuthCallbackServer> {
  const path = options.path ?? "/callback";
  let pending:
    | { resolve: (result: OAuthCallbackResult) => void; reject: (err: Error) => void }
    | undefined;

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== path) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const error = url.searchParams.get("error");
    if (error) {
      const message = url.searchParams.get("error_description") ?? error;
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(htmlError(message));
      pending?.reject(new Error(message));
      pending = undefined;
      return;
    }

    const code = url.searchParams.get("code");
    if (!code) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(htmlError("Missing authorization code."));
      pending?.reject(new Error("Missing authorization code."));
      pending = undefined;
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HTML_SUCCESS);
    pending?.resolve({ code, state: url.searchParams.get("state") });
    pending = undefined;
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;

  return {
    redirectUrl: `http://127.0.0.1:${port}${path}`,
    waitForCode(timeoutMs = DEFAULT_TIMEOUT_MS) {
      return new Promise<OAuthCallbackResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending = undefined;
          reject(new Error("Timed out waiting for OAuth authorization."));
        }, timeoutMs);
        timer.unref?.();
        pending = {
          resolve: (result) => {
            clearTimeout(timer);
            resolve(result);
          },
          reject: (err) => {
            clearTimeout(timer);
            reject(err);
          },
        };
      });
    },
    close() {
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

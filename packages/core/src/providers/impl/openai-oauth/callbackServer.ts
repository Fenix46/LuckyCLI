import { createServer, type Server } from "node:http";
import type { PkceCodes } from "./pkce.js";
import { exchangeCodeForTokens, OAUTH_CALLBACK_PORT, type TokenResponse } from "./tokens.js";

const REDIRECT_URI = `http://localhost:${OAUTH_CALLBACK_PORT}/auth/callback`;

const HTML_SUCCESS = `<!doctype html>
<html><head><title>LuckyCLI Authorization Successful</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0d1117;color:#f0f6fc}.box{text-align:center;padding:2rem}h1{color:#58a6ff}p{color:#8b949e}</style>
</head><body><div class="box"><h1>Authorization Successful</h1><p>You can close this window and return to LuckyCLI.</p></div><script>setTimeout(()=>window.close(),2000)</script></body></html>`;

function htmlError(message: string): string {
  return `<!doctype html>
<html><head><title>LuckyCLI Authorization Failed</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0d1117;color:#f0f6fc}.box{text-align:center;padding:2rem}h1{color:#f85149}.err{font-family:monospace;margin-top:1rem;padding:1rem;background:#161b22;color:#ffa657}</style>
</head><body><div class="box"><h1>Authorization Failed</h1><div class="err">${message}</div></div></body></html>`;
}

interface PendingOAuth {
  pkce: PkceCodes;
  state: string;
  resolve: (tokens: TokenResponse) => void;
  reject: (err: Error) => void;
}

let server: Server | undefined;
let pending: PendingOAuth | undefined;

export function getRedirectUri(): string {
  return REDIRECT_URI;
}

export async function startCallbackServer(): Promise<void> {
  if (server) return;

  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${OAUTH_CALLBACK_PORT}`);

    if (url.pathname !== "/auth/callback") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const error = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");
    if (error) {
      const message = errorDescription ?? error;
      pending?.reject(new Error(message));
      pending = undefined;
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(htmlError(message));
      return;
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code) {
      const message = "Missing authorization code.";
      pending?.reject(new Error(message));
      pending = undefined;
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(htmlError(message));
      return;
    }
    if (!pending || state !== pending.state) {
      const message = "Invalid OAuth state.";
      pending?.reject(new Error(message));
      pending = undefined;
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(htmlError(message));
      return;
    }

    const current = pending;
    pending = undefined;
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HTML_SUCCESS);

    exchangeCodeForTokens(code, REDIRECT_URI, current.pkce)
      .then(current.resolve)
      .catch(current.reject);
  });

  await new Promise<void>((resolve, reject) => {
    server!.listen(OAUTH_CALLBACK_PORT, () => resolve());
    server!.on("error", reject);
  });
}

export function stopCallbackServer(): void {
  if (!server) return;
  server.close();
  server = undefined;
}

export function waitForCallback(
  pkce: PkceCodes,
  state: string,
  timeoutMs = 5 * 60 * 1000,
): Promise<TokenResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending) return;
      pending = undefined;
      reject(new Error("OAuth timeout; authorization took too long."));
    }, timeoutMs);

    pending = {
      pkce,
      state,
      resolve: (tokens) => {
        clearTimeout(timer);
        resolve(tokens);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    };
  });
}

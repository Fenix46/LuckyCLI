import { OAuth2Client, CodeChallengeMethod } from "google-auth-library";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import * as http from "node:http";
import * as net from "node:net";

declare const __LUCKY_GOOGLE_OAUTH_CLIENT_ID__: string | undefined;
declare const __LUCKY_GOOGLE_OAUTH_CLIENT_SECRET__: string | undefined;
declare const __LUCKY_ANTIGRAVITY_OAUTH_CLIENT_ID__: string | undefined;
declare const __LUCKY_ANTIGRAVITY_OAUTH_CLIENT_SECRET__: string | undefined;

const OAUTH_CLIENT_ID_ENV = "LUCKY_GOOGLE_OAUTH_CLIENT_ID";
const OAUTH_CLIENT_SECRET_ENV = "LUCKY_GOOGLE_OAUTH_CLIENT_SECRET";
const ANTIGRAVITY_OAUTH_CLIENT_ID_ENV = "LUCKY_ANTIGRAVITY_OAUTH_CLIENT_ID";
const ANTIGRAVITY_OAUTH_CLIENT_SECRET_ENV = "LUCKY_ANTIGRAVITY_OAUTH_CLIENT_SECRET";
const OAUTH_SCOPE = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];
const ANTIGRAVITY_OAUTH_SCOPE = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "openid",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/experimentsandconfigs",
];

interface GoogleOAuthFlowOptions {
  clientIdEnv?: string;
  clientSecretEnv?: string;
  scopes?: string[];
  callbackPath?: string;
  redirectHost?: string;
  usePkce?: boolean;
}

export interface OAuthSession {
  url: string;
  tokenPromise: Promise<{ accessToken: string; refreshToken?: string; expiresAt?: number }>;
  stop: () => void;
}

export interface RefreshedGoogleTokens {
  accessToken: string;
  expiresAt?: number;
  idToken?: string;
  scope?: string;
  tokenType?: string;
}

/**
 * Finds an available local port for the loopback callback server.
 */
export function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    let port = 0;
    try {
      const server = net.createServer();
      server.listen(0, () => {
        const address = server.address();
        if (address && typeof address === "object") {
          port = address.port;
        }
      });
      server.on("listening", () => {
        server.close();
        server.unref();
      });
      server.on("error", (e) => reject(e));
      server.on("close", () => resolve(port));
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Generates the Google OAuth authorization URL using a loopback redirect URI
 * and starts a temporary HTTP callback server to capture the code automatically.
 */
export async function startOAuthFlow(options: GoogleOAuthFlowOptions = {}): Promise<OAuthSession> {
  const state = crypto.randomBytes(32).toString("hex");

  let server!: http.Server;

  // Start the HTTP server on port 0 to let the OS allocate a guaranteed free port.
  // This avoids socket TIME_WAIT address reuse collisions.
  const port = await new Promise<number>((resolve, reject) => {
    server = http.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        resolve(address.port);
      } else {
        reject(new Error("Failed to retrieve callback server port."));
      }
    });
    server.on("error", reject);
  });

  const redirectHost = options.redirectHost ?? "127.0.0.1";
  const callbackPath = options.callbackPath ?? "/oauth2callback";
  const redirectUri = `http://${redirectHost}:${port}${callbackPath}`;
  const clientConfig = getGoogleOAuthClientConfig(options);

  const client = new OAuth2Client({
    clientId: clientConfig.clientId,
    clientSecret: clientConfig.clientSecret,
    redirectUri,
  });

  const usePkce = options.usePkce ?? true;
  const verifier = usePkce ? await client.generateCodeVerifierAsync() : undefined;

  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: options.scopes ?? OAUTH_SCOPE,
    ...(verifier
      ? {
          code_challenge_method: CodeChallengeMethod.S256,
          code_challenge: verifier.codeChallenge,
        }
      : {}),
    state,
  });

  const tokenPromise = new Promise<{ accessToken: string; refreshToken?: string; expiresAt?: number }>((resolve, reject) => {
    // Setup request listener on the already-listening server
    server.on("request", async (req, res) => {
      try {
        const parsedUrl = new URL(req.url || "", `http://127.0.0.1:${port}`);
        if (parsedUrl.pathname !== callbackPath) {
          res.writeHead(404);
          res.end("Not Found");
          return;
        }

        const code = parsedUrl.searchParams.get("code");
        const reqState = parsedUrl.searchParams.get("state");

        if (reqState !== state) {
          res.writeHead(400);
          res.end("State mismatch. Possible CSRF attack.");
          reject(new Error("OAuth state mismatch. Possible CSRF attack."));
          return;
        }

        if (!code) {
          res.writeHead(400);
          res.end("No code received.");
          reject(new Error("No authorization code received."));
          return;
        }

        const { tokens } = await client.getToken({
          code,
          ...(verifier ? { codeVerifier: verifier.codeVerifier } : {}),
          redirect_uri: redirectUri,
        });

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <html>
            <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; text-align: center; padding-top: 60px; background-color: #121214; color: #e1e1e6;">
              <h1 style="color: #00f0ff; font-weight: 600;">✦ LuckyCLI Authentication Succeeded ✦</h1>
              <p style="color: #8b949e; margin-top: 10px;">You can now close this tab and return to your terminal.</p>
            </body>
          </html>
        `);

        resolve({
          accessToken: tokens.access_token || "",
          refreshToken: tokens.refresh_token || undefined,
          expiresAt: tokens.expiry_date || undefined,
        });
      } catch (err) {
        res.writeHead(500);
        res.end("Authentication failed.");
        reject(err);
      } finally {
        closeServer(server);
      }
    });

    server.on("error", (err) => {
      reject(err);
    });
  });

  return {
    url,
    tokenPromise,
    stop: () => {
      closeServer(server);
    },
  };
}

export function startAntigravityOAuthFlow(): Promise<OAuthSession> {
  return startOAuthFlow({
    clientIdEnv: ANTIGRAVITY_OAUTH_CLIENT_ID_ENV,
    clientSecretEnv: ANTIGRAVITY_OAUTH_CLIENT_SECRET_ENV,
    scopes: ANTIGRAVITY_OAUTH_SCOPE,
    callbackPath: "/oauth-callback",
    redirectHost: "localhost",
    usePkce: false,
  });
}

function closeServer(server: http.Server): void {
  if (!server.listening) return;
  server.close(() => {
    // best-effort cleanup
  });
}

/**
 * Refreshes an expired access token using the stored refresh token.
 */
export async function refreshAccessToken(
  refreshToken: string,
  options: GoogleOAuthFlowOptions = {},
): Promise<RefreshedGoogleTokens> {
  const clientConfig = getGoogleOAuthClientConfig(options);
  const client = new OAuth2Client({
    clientId: clientConfig.clientId,
    clientSecret: clientConfig.clientSecret,
  });

  client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await client.refreshAccessToken();
  if (!credentials.access_token) {
    throw new Error("Google OAuth refresh did not return an access token.");
  }
  return {
    accessToken: credentials.access_token,
    ...(credentials.expiry_date ? { expiresAt: credentials.expiry_date } : {}),
    ...(credentials.id_token ? { idToken: credentials.id_token } : {}),
    ...(credentials.scope ? { scope: credentials.scope } : {}),
    ...(credentials.token_type ? { tokenType: credentials.token_type } : {}),
  };
}

export async function refreshAntigravityAccessToken(
  refreshToken: string,
): Promise<RefreshedGoogleTokens> {
  return refreshAccessToken(refreshToken, {
    clientIdEnv: ANTIGRAVITY_OAUTH_CLIENT_ID_ENV,
    clientSecretEnv: ANTIGRAVITY_OAUTH_CLIENT_SECRET_ENV,
  });
}

function getGoogleOAuthClientConfig(options: GoogleOAuthFlowOptions = {}): { clientId: string; clientSecret: string } {
  const clientIdEnv = options.clientIdEnv ?? OAUTH_CLIENT_ID_ENV;
  const clientSecretEnv = options.clientSecretEnv ?? OAUTH_CLIENT_SECRET_ENV;
  const clientId =
    injectedClientId(clientIdEnv) ?? process.env[clientIdEnv];
  const clientSecret =
    injectedClientSecret(clientSecretEnv) ?? process.env[clientSecretEnv];
  if (!clientId || !clientSecret) {
    throw new Error(
      `Google OAuth requires ${clientIdEnv} and ${clientSecretEnv} to be set.`,
    );
  }
  return { clientId, clientSecret };
}

function injectedClientId(envName: string): string | undefined {
  if (envName === OAUTH_CLIENT_ID_ENV) {
    return buildInjectedValue(
      typeof __LUCKY_GOOGLE_OAUTH_CLIENT_ID__ === "undefined"
        ? undefined
        : __LUCKY_GOOGLE_OAUTH_CLIENT_ID__,
    );
  }
  if (envName === ANTIGRAVITY_OAUTH_CLIENT_ID_ENV) {
    return buildInjectedValue(
      typeof __LUCKY_ANTIGRAVITY_OAUTH_CLIENT_ID__ === "undefined"
        ? undefined
        : __LUCKY_ANTIGRAVITY_OAUTH_CLIENT_ID__,
    );
  }
  return undefined;
}

function injectedClientSecret(envName: string): string | undefined {
  if (envName === OAUTH_CLIENT_SECRET_ENV) {
    return buildInjectedValue(
      typeof __LUCKY_GOOGLE_OAUTH_CLIENT_SECRET__ === "undefined"
        ? undefined
        : __LUCKY_GOOGLE_OAUTH_CLIENT_SECRET__,
    );
  }
  if (envName === ANTIGRAVITY_OAUTH_CLIENT_SECRET_ENV) {
    return buildInjectedValue(
      typeof __LUCKY_ANTIGRAVITY_OAUTH_CLIENT_SECRET__ === "undefined"
        ? undefined
        : __LUCKY_ANTIGRAVITY_OAUTH_CLIENT_SECRET__,
    );
  }
  return undefined;
}

function buildInjectedValue(value: string | undefined): string | undefined {
  return value && value !== "__unset__" ? value : undefined;
}

/**
 * Opens a URL in the default browser in a cross-platform manner.
 */
export function openBrowser(url: string): void {
  if (!isBrowserUrl(url)) return;

  const commands = getBrowserOpenCommands(process.platform, process.env);
  const tryOpen = (index: number): void => {
    const command = commands[index];
    if (!command) return;

    const child = spawn(command.command, [...command.args, url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", () => tryOpen(index + 1));
    child.unref();
  };

  tryOpen(0);
}

export interface BrowserOpenCommand {
  command: string;
  args: string[];
}

export function getBrowserOpenCommands(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv = process.env,
): BrowserOpenCommand[] {
  if (platform === "darwin") return [{ command: "open", args: [] }];
  if (platform === "win32") {
    // Do NOT use `cmd /c start`: cmd treats the `&` in the OAuth URL's query
    // string as a command separator, truncating it and dropping params such as
    // client_id. rundll32 receives the URL as a single argv element, untouched.
    return [{ command: "rundll32", args: ["url.dll,FileProtocolHandler"] }];
  }
  if (isWsl(env)) return [{ command: "wslview", args: [] }, ...linuxBrowserOpenCommands()];
  return linuxBrowserOpenCommands();
}

function linuxBrowserOpenCommands(): BrowserOpenCommand[] {
  return [
    { command: "xdg-open", args: [] },
    { command: "gio", args: ["open"] },
    { command: "gnome-open", args: [] },
    { command: "kde-open", args: [] },
  ];
}

function isBrowserUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isWsl(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP);
}

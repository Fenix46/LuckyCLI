import { OAuth2Client, CodeChallengeMethod } from "google-auth-library";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import * as http from "node:http";
import * as net from "node:net";

const OAUTH_CLIENT_ID_ENV = "LUCKY_GOOGLE_OAUTH_CLIENT_ID";
const OAUTH_CLIENT_SECRET_ENV = "LUCKY_GOOGLE_OAUTH_CLIENT_SECRET";
const OAUTH_SCOPE = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

export interface OAuthSession {
  url: string;
  tokenPromise: Promise<{ accessToken: string; refreshToken?: string }>;
  stop: () => void;
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
export async function startOAuthFlow(): Promise<OAuthSession> {
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

  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
  const clientConfig = getGoogleOAuthClientConfig();

  const client = new OAuth2Client({
    clientId: clientConfig.clientId,
    clientSecret: clientConfig.clientSecret,
    redirectUri,
  });

  const verifier = await client.generateCodeVerifierAsync();

  const url = client.generateAuthUrl({
    access_type: "offline",
    scope: OAUTH_SCOPE,
    code_challenge_method: CodeChallengeMethod.S256,
    code_challenge: verifier.codeChallenge,
    state,
  });

  const tokenPromise = new Promise<{ accessToken: string; refreshToken?: string }>((resolve, reject) => {
    // Setup request listener on the already-listening server
    server.on("request", async (req, res) => {
      try {
        const parsedUrl = new URL(req.url || "", `http://127.0.0.1:${port}`);
        if (parsedUrl.pathname !== "/oauth2callback") {
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
          codeVerifier: verifier.codeVerifier,
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
): Promise<string> {
  const clientConfig = getGoogleOAuthClientConfig();
  const client = new OAuth2Client({
    clientId: clientConfig.clientId,
    clientSecret: clientConfig.clientSecret,
  });

  client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await client.refreshAccessToken();
  return credentials.access_token || "";
}

function getGoogleOAuthClientConfig(): { clientId: string; clientSecret: string } {
  const clientId = process.env[OAUTH_CLIENT_ID_ENV];
  const clientSecret = process.env[OAUTH_CLIENT_SECRET_ENV];
  if (!clientId || !clientSecret) {
    throw new Error(
      `Google OAuth requires ${OAUTH_CLIENT_ID_ENV} and ${OAUTH_CLIENT_SECRET_ENV} to be set.`,
    );
  }
  return { clientId, clientSecret };
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
  if (platform === "win32") return [{ command: "cmd", args: ["/c", "start", ""] }];
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

import { OAuth2Client, CodeChallengeMethod } from "google-auth-library";
import { exec } from "node:child_process";
import crypto from "node:crypto";
import * as http from "node:http";
import * as net from "node:net";

const OAUTH_CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com";
const OAUTH_CLIENT_SECRET = "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";
const OAUTH_SCOPE = [
  "https://www.googleapis.com/auth/generative-language",
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

  const client = new OAuth2Client({
    clientId: OAUTH_CLIENT_ID,
    clientSecret: OAUTH_CLIENT_SECRET,
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
        server.close();
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
      server.close();
    },
  };
}

/**
 * Refreshes an expired access token using the stored refresh token.
 */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<string> {
  const client = new OAuth2Client({
    clientId: OAUTH_CLIENT_ID,
    clientSecret: OAUTH_CLIENT_SECRET,
  });

  client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await client.refreshAccessToken();
  return credentials.access_token || "";
}

/**
 * Opens a URL in the default browser in a cross-platform manner.
 */
export function openBrowser(url: string): void {
  const start =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
      ? "start"
      : "xdg-open";
  exec(`${start} "${url.replace(/"/g, '\\"')}"`, () => {
    // best-effort, ignore errors
  });
}


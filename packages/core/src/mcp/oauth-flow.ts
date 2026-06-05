/**
 * Interactive OAuth authorization for a remote MCP server.
 *
 * Drives the full loop: connect with an auth-aware transport, let the SDK send
 * the user to the authorization page, capture the redirect code on a loopback
 * server, redeem it, and reconnect so tokens land in the auth store. After this
 * resolves, normal (non-interactive) connects reuse and refresh those tokens.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startOAuthCallbackServer } from "./oauth-callback.js";
import { McpOAuthProvider } from "./oauth-provider.js";
import { CORE_VERSION } from "../version.js";

export interface AuthorizeMcpServerOptions {
  /** Logical server name (auth store key). */
  name: string;
  /** Remote server URL. */
  url: string;
  scope?: string;
  clientName?: string;
  storePath?: string;
  /** Loopback port for the redirect server (defaults to an ephemeral port). */
  callbackPort?: number;
  /** How long to wait for the user to authorize. */
  timeoutMs?: number;
  /** Override how the authorization URL is presented (defaults to a browser). */
  onAuthorizationUrl?: (url: URL) => void | Promise<void>;
}

export type AuthorizeMcpResult =
  | { status: "already-authorized" }
  | { status: "authorized" };

export async function authorizeMcpServer(
  options: AuthorizeMcpServerOptions,
): Promise<AuthorizeMcpResult> {
  const callback = await startOAuthCallbackServer(
    options.callbackPort ? { port: options.callbackPort } : {},
  );

  const provider = new McpOAuthProvider(options.name, {
    redirectUrl: callback.redirectUrl,
    ...(options.scope ? { scope: options.scope } : {}),
    ...(options.clientName ? { clientName: options.clientName } : {}),
    ...(options.storePath ? { storePath: options.storePath } : {}),
    ...(options.onAuthorizationUrl ? { onRedirect: options.onAuthorizationUrl } : {}),
  });

  const newTransport = () =>
    new StreamableHTTPClientTransport(new URL(options.url), { authProvider: provider });
  const newClient = () => new Client({ name: options.clientName ?? "lucky", version: CORE_VERSION });

  try {
    const transport = newTransport();
    const client = newClient();
    try {
      // Succeeds outright if stored tokens are still valid (or no auth needed).
      await client.connect(transport);
      await client.close();
      return { status: "already-authorized" };
    } catch (error) {
      if (!(error instanceof UnauthorizedError)) throw error;
      // The provider has redirected the user to authorize; wait for the code.
      const { code } = await callback.waitForCode(options.timeoutMs);
      await transport.finishAuth(code);
    }

    // Tokens are stored now — reconnect with a fresh transport to verify.
    const verifyTransport = newTransport();
    const verifyClient = newClient();
    await verifyClient.connect(verifyTransport);
    await verifyClient.close();
    return { status: "authorized" };
  } finally {
    await callback.close();
  }
}

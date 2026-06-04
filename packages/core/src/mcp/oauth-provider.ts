/**
 * An `OAuthClientProvider` for MCP remote servers, backed by the on-disk auth
 * store. The MCP SDK handles discovery, token exchange and refresh; this just
 * supplies/persists the client registration, tokens and PKCE verifier, and
 * decides what to do when the user must be sent to the authorization page.
 */

import { randomUUID } from "node:crypto";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { openBrowser } from "../providers/impl/gemini/GoogleAuthHelper.js";
import { getMcpAuthEntry, updateMcpAuthEntry } from "./auth-store.js";

export interface McpOAuthProviderOptions {
  /** Loopback redirect URI registered with the server. */
  redirectUrl: string;
  clientName?: string;
  scope?: string;
  /** Override the auth store path (tests). */
  storePath?: string;
  /**
   * Invoked when the SDK needs the user to authorize. Defaults to opening a
   * browser. Background/non-interactive callers should pass a function that
   * throws, so a connection that needs login fails cleanly instead of popping a
   * browser window unexpectedly.
   */
  onRedirect?: (url: URL) => void | Promise<void>;
}

export class McpOAuthProvider implements OAuthClientProvider {
  constructor(
    private readonly serverName: string,
    private readonly options: McpOAuthProviderOptions,
  ) {}

  get redirectUrl(): string {
    return this.options.redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.options.redirectUrl],
      client_name: this.options.clientName ?? "LuckyCLI",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      ...(this.options.scope ? { scope: this.options.scope } : {}),
    };
  }

  state(): string {
    return randomUUID();
  }

  clientInformation(): OAuthClientInformationFull | undefined {
    return getMcpAuthEntry(this.serverName, this.options.storePath).clientInformation;
  }

  saveClientInformation(clientInformation: OAuthClientInformationFull): void {
    updateMcpAuthEntry(this.serverName, { clientInformation }, this.options.storePath);
  }

  tokens(): OAuthTokens | undefined {
    return getMcpAuthEntry(this.serverName, this.options.storePath).tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    updateMcpAuthEntry(this.serverName, { tokens }, this.options.storePath);
  }

  saveCodeVerifier(codeVerifier: string): void {
    updateMcpAuthEntry(this.serverName, { codeVerifier }, this.options.storePath);
  }

  codeVerifier(): string {
    const verifier = getMcpAuthEntry(this.serverName, this.options.storePath).codeVerifier;
    if (!verifier) {
      throw new Error(`No PKCE code verifier stored for MCP server "${this.serverName}".`);
    }
    return verifier;
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (this.options.onRedirect) {
      await this.options.onRedirect(authorizationUrl);
      return;
    }
    openBrowser(authorizationUrl.toString());
  }
}

/**
 * A provider for non-interactive connects (e.g. background startup): it uses any
 * stored tokens and lets the SDK refresh them, but refuses to launch an
 * interactive login, surfacing a clear error instead.
 */
export function nonInteractiveMcpOAuthProvider(
  serverName: string,
  options: Omit<McpOAuthProviderOptions, "onRedirect">,
): McpOAuthProvider {
  return new McpOAuthProvider(serverName, {
    ...options,
    onRedirect: () => {
      throw new Error(
        `MCP server "${serverName}" requires authorization. Run "lucky mcp login ${serverName}".`,
      );
    },
  });
}

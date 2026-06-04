import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { McpOAuthProvider, nonInteractiveMcpOAuthProvider } from "./oauth-provider.js";

const tmpDirs: string[] = [];
const redirectUrl = "http://127.0.0.1:7632/mcp/callback";

function tempStorePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "lucky-mcp-oauth-"));
  tmpDirs.push(dir);
  return join(dir, "mcp-auth.json");
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("McpOAuthProvider", () => {
  it("persists client info, tokens and the code verifier in the auth store", () => {
    const storePath = tempStorePath();
    const provider = new McpOAuthProvider("docs", { redirectUrl, storePath });

    expect(provider.clientInformation()).toBeUndefined();
    expect(provider.tokens()).toBeUndefined();

    provider.saveClientInformation({ client_id: "cid", redirect_uris: [redirectUrl] });
    provider.saveTokens({ access_token: "tok", token_type: "Bearer" });
    provider.saveCodeVerifier("verifier-1");

    expect(provider.clientInformation()?.client_id).toBe("cid");
    expect(provider.tokens()?.access_token).toBe("tok");
    expect(provider.codeVerifier()).toBe("verifier-1");
  });

  it("exposes client metadata with the loopback redirect", () => {
    const provider = new McpOAuthProvider("docs", { redirectUrl, storePath: tempStorePath() });
    expect(provider.clientMetadata.redirect_uris).toEqual([redirectUrl]);
    expect(provider.clientMetadata.response_types).toEqual(["code"]);
  });

  it("throws when asked for a code verifier that was never saved", () => {
    const provider = new McpOAuthProvider("docs", { redirectUrl, storePath: tempStorePath() });
    expect(() => provider.codeVerifier()).toThrow(/code verifier/i);
  });

  it("routes the authorization url to onRedirect when provided", async () => {
    let captured: URL | undefined;
    const provider = new McpOAuthProvider("docs", {
      redirectUrl,
      storePath: tempStorePath(),
      onRedirect: (url) => {
        captured = url;
      },
    });
    await provider.redirectToAuthorization(new URL("https://auth.example.com/authorize"));
    expect(captured?.href).toBe("https://auth.example.com/authorize");
  });

  it("refuses interactive authorization in the non-interactive provider", async () => {
    const provider = nonInteractiveMcpOAuthProvider("docs", { redirectUrl, storePath: tempStorePath() });
    await expect(
      provider.redirectToAuthorization(new URL("https://auth.example.com/authorize")),
    ).rejects.toThrow(/lucky mcp login/);
  });
});

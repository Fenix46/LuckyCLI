import { describe, expect, it } from "vitest";
import { startOAuthCallbackServer } from "./oauth-callback.js";

describe("startOAuthCallbackServer", () => {
  it("resolves with the authorization code and state from the redirect", async () => {
    const callback = await startOAuthCallbackServer();
    try {
      const waiting = callback.waitForCode(5_000);
      await fetch(`${callback.redirectUrl}?code=abc123&state=xyz`);
      await expect(waiting).resolves.toEqual({ code: "abc123", state: "xyz" });
    } finally {
      await callback.close();
    }
  });

  it("rejects when the authorization server reports an error", async () => {
    const callback = await startOAuthCallbackServer();
    try {
      const waiting = callback.waitForCode(5_000);
      // Attach the rejection handler before triggering the redirect, so the
      // reject (which fires during fetch) is never momentarily unhandled.
      const assertion = expect(waiting).rejects.toThrow(/nope/);
      await fetch(`${callback.redirectUrl}?error=access_denied&error_description=nope`);
      await assertion;
    } finally {
      await callback.close();
    }
  });
});

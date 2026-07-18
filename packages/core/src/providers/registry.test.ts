import { beforeEach, describe, expect, it } from "vitest";
import { getProvider, registerProviderFactory, resetProvider } from "./registry.js";
import type { IProvider } from "./IProvider.js";
import type { OpencodeZenCredentials } from "./types.js";

// A minimal fake provider is enough here: this test is about the registry's
// caching/invalidation behavior, not about any real provider's wire format.
function makeFakeProvider(credentials: OpencodeZenCredentials): IProvider {
  return { info: { id: "opencode-zen" } as never, credentials } as unknown as IProvider;
}

describe("provider registry credential invalidation", () => {
  beforeEach(() => {
    resetProvider("opencode-zen");
    registerProviderFactory("opencode-zen", (c) => makeFakeProvider(c as OpencodeZenCredentials));
  });

  it("reuses the cached instance when credentials are unchanged", () => {
    const creds: OpencodeZenCredentials = { type: "opencode-zen", apiKey: "key-a" };
    const first = getProvider("opencode-zen", creds);
    const second = getProvider("opencode-zen", { type: "opencode-zen", apiKey: "key-a" });
    expect(second).toBe(first);
  });

  it("rebuilds the instance when credentials change, even without an explicit resetProvider call", () => {
    const first = getProvider("opencode-zen", { type: "opencode-zen", apiKey: "key-a" });
    const second = getProvider("opencode-zen", { type: "opencode-zen", apiKey: "key-b" });

    expect(second).not.toBe(first);
    expect((second as unknown as { credentials: OpencodeZenCredentials }).credentials.apiKey).toBe("key-b");
  });

  it("still honors an explicit resetProvider call", () => {
    const first = getProvider("opencode-zen", { type: "opencode-zen", apiKey: "key-a" });
    resetProvider("opencode-zen");
    const second = getProvider("opencode-zen", { type: "opencode-zen", apiKey: "key-a" });

    expect(second).not.toBe(first);
  });
});

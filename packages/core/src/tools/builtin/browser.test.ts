import { describe, expect, it, vi } from "vitest";
import type { BrowserBridge, ToolContext } from "../types.js";
import { browserTool } from "./browser.js";

function ctx(bridge?: BrowserBridge): ToolContext {
  return { cwd: "/project", ...(bridge ? { browser: bridge } : {}) };
}

describe("browser tool", () => {
  it("explains how to connect the extension when no bridge is present", async () => {
    const result = await browserTool.execute({ action: "tabs" }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain("/browser");
  });

  it("maps actions to bridge methods and forwards only the relevant params", async () => {
    const request = vi.fn(async () => ({ ok: true }));
    const bridge: BrowserBridge = { request };
    await browserTool.execute({ action: "open", url: "https://example.com" }, ctx(bridge));
    expect(request).toHaveBeenCalledWith("tabs.open", { url: "https://example.com" });

    await browserTool.execute({ action: "activate", tabId: 7 }, ctx(bridge));
    expect(request).toHaveBeenCalledWith("tabs.activate", { tabId: 7 });

    await browserTool.execute(
      { action: "type", selector: "#q", text: "hello", submit: true },
      ctx(bridge),
    );
    expect(request).toHaveBeenCalledWith("page.type", {
      selector: "#q",
      text: "hello",
      submit: true,
    });
  });

  it("formats a page snapshot as title, url and text", async () => {
    const request = vi.fn(async () => ({
      title: "Example",
      url: "https://example.com",
      text: "Hello world",
    }));
    const result = await browserTool.execute({ action: "snapshot" }, ctx({ request }));
    expect(result.isError).toBeUndefined();
    expect(result.content).toBe("# Example\nhttps://example.com\n\nHello world");
  });

  it("truncates a huge snapshot", async () => {
    const request = vi.fn(async () => ({
      title: "Big",
      url: "https://example.com",
      text: "x".repeat(30_000),
    }));
    const result = await browserTool.execute({ action: "snapshot" }, ctx({ request }));
    expect(result.content.length).toBeLessThanOrEqual(20_000);
  });

  it("turns a bridge failure into an error result", async () => {
    const request = vi.fn(async () => {
      throw new Error("extension offline");
    });
    const result = await browserTool.execute({ action: "tabs" }, ctx({ request }));
    expect(result.isError).toBe(true);
    expect(result.content).toContain("extension offline");
  });
});

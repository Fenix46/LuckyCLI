import { describe, expect, it } from "vitest";
import { ToolRegistry } from "../registry.js";
import { htmlToReadableText, httpFetchTool, renderFetchedText } from "./http-fetch.js";

describe("http_fetch tool", () => {
  const registry = new ToolRegistry().register(httpFetchTool);

  it("rejects non-http URLs", async () => {
    const result = await registry.execute(
      "http_fetch",
      { url: "file:///etc/passwd" },
      { cwd: process.cwd() },
    );

    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/only http and https/i);
  });

  it("rejects localhost URLs", async () => {
    const result = await registry.execute(
      "http_fetch",
      { url: "http://127.0.0.1:12345/" },
      { cwd: process.cwd() },
    );

    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/private or local/i);
  });

  it("converts HTML to readable markdown-like text", () => {
    const html = `<!doctype html>
      <html>
        <head>
          <title>Docs &amp; API</title>
          <style>body { color: red }</style>
          <script>alert('x')</script>
        </head>
        <body>
          <h1>Welcome</h1>
          <p>Hello&nbsp;<strong>world</strong>.</p>
          <h2>Links</h2>
          <ul><li><a href="/guide">Guide</a></li><li>Plain item</li></ul>
        </body>
      </html>`;

    const text = htmlToReadableText(html, new URL("https://example.com/docs/"));

    expect(text).toContain("# Docs & API");
    expect(text).toContain("# Welcome");
    expect(text).toContain("Hello world.");
    expect(text).toContain("## Links");
    expect(text).toContain("- Guide (https://example.com/guide)");
    expect(text).toContain("- Plain item");
    expect(text).not.toContain("alert");
    expect(text).not.toContain("color: red");
  });

  it("detects HTML from content type and leaves plain text untouched", () => {
    expect(renderFetchedText("<p>Hello</p>", "text/html", new URL("https://example.com"))).toBe("Hello");
    expect(renderFetchedText("<not really html>", "text/plain", new URL("https://example.com"))).toBe("<not really html>");
  });
});

import { describe, expect, it } from "vitest";
import { ToolRegistry } from "../registry.js";
import { httpFetchTool } from "./http-fetch.js";

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
});

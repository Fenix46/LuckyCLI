import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "./registry.js";
import { defineTool } from "./types.js";

const echo = defineTool({
  name: "echo",
  description: "Echo the message back.",
  schema: z.object({ message: z.string() }),
  async execute({ message }) {
    return { content: message };
  },
});

describe("ToolRegistry", () => {
  it("exposes JSON Schema definitions for registered tools", () => {
    const defs = new ToolRegistry().register(echo).definitions();
    expect(defs).toHaveLength(1);
    expect(defs[0]?.name).toBe("echo");
    expect(defs[0]?.parameters).toMatchObject({ type: "object" });
  });

  it("emits draft-07 numeric bounds (not the draft-04 boolean form)", () => {
    // Strict providers (DeepSeek via opencode Zen) reject the openApi3 target's
    // `exclusiveMinimum: true`. Draft-07 must emit the numeric form, and we drop
    // the `$schema` annotation providers don't use.
    const bounded = defineTool({
      name: "bounded",
      description: "Has a positive integer bound.",
      schema: z.object({ limit: z.number().int().positive().max(2000) }),
      async execute() {
        return { content: "ok" };
      },
    });
    const params = new ToolRegistry().register(bounded).definitions()[0]
      ?.parameters as {
      $schema?: unknown;
      properties: { limit: { exclusiveMinimum: unknown } };
    };
    expect(params.$schema).toBeUndefined();
    expect(params.properties.limit.exclusiveMinimum).toBe(0);
  });

  it("preserves an explicit provider-facing JSON schema override", () => {
    const passthrough = defineTool({
      name: "passthrough",
      description: "Passthrough JSON schema.",
      schema: z.object({}).passthrough(),
      parametersSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
        additionalProperties: false,
      },
      async execute(input) {
        return { content: JSON.stringify(input) };
      },
    });

    const defs = new ToolRegistry().register(passthrough).definitions();
    expect(defs[0]?.parameters).toEqual({
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
      additionalProperties: false,
    });
  });

  it("caches definitions and invalidates them only when a tool is registered", () => {
    const reg = new ToolRegistry().register(echo);
    const first = reg.definitions();
    expect(reg.definitions()).toBe(first);
    expect(reg.definitionsJsonLength()).toBe(JSON.stringify(first).length);

    const another = defineTool({
      name: "another",
      description: "Another tool.",
      schema: z.object({ flag: z.boolean() }),
      async execute() {
        return { content: "ok" };
      },
    });
    reg.register(another);
    const second = reg.definitions();
    expect(second).not.toBe(first);
    expect(second).toHaveLength(2);
    // The existing tool's schema was not regenerated.
    expect(second[0]?.parameters).toBe(first[0]?.parameters);
    expect(reg.definitionsJsonLength()).toBe(JSON.stringify(second).length);
  });

  it("keeps small deferred sets visible and hides large ones behind search", () => {
    const deferred = (name: string, description = `${name} tool`) =>
      defineTool({
        name,
        description,
        schema: z.object({}),
        defer: true,
        async execute() {
          return { content: `${name} ran` };
        },
      });

    const small = new ToolRegistry().register(deferred("mcp_one")).register(deferred("mcp_two"));
    expect(small.hasDeferredTools()).toBe(false);
    expect(small.definitions().map((d) => d.name)).toEqual(["mcp_one", "mcp_two"]);
    expect(small.searchDeferred("one")).toEqual([]);

    const large = new ToolRegistry();
    for (let i = 0; i < 5; i++) large.register(deferred(`mcp_${i}`, i === 0 ? "jira issue search" : "other"));
    expect(large.hasDeferredTools()).toBe(true);
    expect(large.definitions()).toEqual([]);
    const matches = large.searchDeferred("jira", 5);
    expect(matches.map((m) => m.name)).toEqual(["mcp_0"]);
    expect(matches[0]?.parameters).toMatchObject({ type: "object" });
    expect(large.activate(["mcp_0"])).toEqual(["mcp_0"]);
    expect(large.activate(["mcp_0"])).toEqual([]);
    expect(large.definitions().map((d) => d.name)).toEqual(["mcp_0"]);
    const length = large.definitionsJsonLength();
    expect(length).toBe(JSON.stringify(large.definitions()).length);
    expect(large.activate(["mcp_1"])).toEqual(["mcp_1"]);
    expect(large.definitionsJsonLength()).toBeGreaterThan(length);
  });

  it("defers a few tools when their schemas are large enough", () => {
    const big = { type: "object", description: "x".repeat(5_000) };
    const deferred = (name: string) =>
      defineTool({
        name,
        description: name,
        schema: z.object({}),
        parametersSchema: big,
        defer: true,
        async execute() {
          return { content: "ok" };
        },
      });
    const reg = new ToolRegistry().register(deferred("mcp_a")).register(deferred("mcp_b"));
    expect(reg.hasDeferredTools()).toBe(true);
    expect(reg.definitions()).toEqual([]);
  });

  it("validates input and runs the tool", async () => {
    const reg = new ToolRegistry().register(echo);
    const ok = await reg.execute("echo", { message: "hi" }, { cwd: "/" });
    expect(ok).toEqual({ content: "hi" });
  });

  it("returns an error result on invalid input instead of throwing", async () => {
    const reg = new ToolRegistry().register(echo);
    const bad = await reg.execute("echo", { message: 42 }, { cwd: "/" });
    expect(bad.isError).toBe(true);
  });

  it("rejects unknown tools gracefully", async () => {
    const res = await new ToolRegistry().execute("nope", {}, { cwd: "/" });
    expect(res.isError).toBe(true);
  });
});

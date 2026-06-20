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

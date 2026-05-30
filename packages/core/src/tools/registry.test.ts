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

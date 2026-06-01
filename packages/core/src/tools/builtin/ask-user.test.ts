import { describe, expect, it } from "vitest";
import { ToolRegistry } from "../registry.js";
import { askUserTool } from "./ask-user.js";

describe("ask_user tool", () => {
  it("returns an error without an askUser bridge", async () => {
    const registry = new ToolRegistry().register(askUserTool);
    const result = await registry.execute(
      "ask_user",
      { question: "Proceed?", options: ["yes", "no"] },
      { cwd: process.cwd() },
    );

    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/no interactive askUser bridge/i);
  });

  it("asks through the context bridge", async () => {
    const registry = new ToolRegistry().register(askUserTool);
    const result = await registry.execute(
      "ask_user",
      { question: "Proceed?", options: ["yes", "no"], allowFreeText: false },
      {
        cwd: process.cwd(),
        askUser: async (request) => {
          expect(request).toEqual({
            question: "Proceed?",
            options: ["yes", "no"],
            allowFreeText: false,
          });
          return "yes";
        },
      },
    );

    expect(result).toEqual({ content: "User answered: yes" });
  });
});

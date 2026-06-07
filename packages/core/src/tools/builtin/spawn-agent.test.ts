import { describe, expect, it } from "vitest";
import { ToolRegistry } from "../registry.js";
import type { SpawnAgentResult } from "../types.js";
import { spawnAgentTool } from "./spawn-agent.js";

const INPUT = { agent: "frontend", task: "build the login page" };

describe("spawn_agent tool", () => {
  it("errors without a runSubAgent bridge", async () => {
    const result = await new ToolRegistry()
      .register(spawnAgentTool)
      .execute("spawn_agent", INPUT, { cwd: process.cwd() });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/no runSubAgent bridge/i);
  });

  it("relays the sub-agent's report", async () => {
    const runSubAgent = async (): Promise<SpawnAgentResult> => ({
      report: "Built the login page with 3 components.",
    });
    const result = await new ToolRegistry()
      .register(spawnAgentTool)
      .execute("spawn_agent", INPUT, {
        cwd: process.cwd(),
        runSubAgent,
      });
    expect(result.isError).toBeFalsy();
    expect(result.content).toMatch(/frontend/);
    expect(result.content).toMatch(/Built the login page/);
  });

  it("surfaces a sub-agent failure as a tool error", async () => {
    const runSubAgent = async (): Promise<SpawnAgentResult> => {
      throw new Error("not logged into provider gemini");
    };
    const result = await new ToolRegistry()
      .register(spawnAgentTool)
      .execute("spawn_agent", INPUT, {
        cwd: process.cwd(),
        runSubAgent,
      });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/not logged into provider gemini/);
  });
});

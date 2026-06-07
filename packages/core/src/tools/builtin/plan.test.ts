import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToolRegistry } from "../registry.js";
import type { PlanDecision } from "../../agent/plan.js";
import { listTasks, resetTaskList, setActiveTaskListId } from "../../tasks/store.js";
import { presentPlanTool } from "./plan.js";

const PLAN_INPUT = {
  title: "Add a feature",
  plan: "## Steps\n1. do x\n2. do y",
  tasks: [
    { subject: "Do x", description: "implement x", activeForm: "Doing x" },
    { subject: "Do y", description: "implement y" },
  ],
};

describe("present_plan tool", () => {
  let taskListId: string;

  beforeEach(() => {
    taskListId = `test-plan-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setActiveTaskListId(taskListId);
  });

  afterEach(() => {
    resetTaskList(taskListId);
  });

  const run = (presentPlan: (p: unknown) => Promise<PlanDecision>) =>
    new ToolRegistry()
      .register(presentPlanTool)
      .execute("present_plan", PLAN_INPUT, {
        cwd: process.cwd(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        presentPlan: presentPlan as any,
      });

  it("errors without a presentPlan bridge", async () => {
    const result = await new ToolRegistry()
      .register(presentPlanTool)
      .execute("present_plan", PLAN_INPUT, { cwd: process.cwd() });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/no interactive presentPlan bridge/i);
  });

  it("creates the tasks on accept", async () => {
    const result = await run(async () => ({ action: "accept" }));
    expect(result.isError).toBeFalsy();
    expect(result.content).toMatch(/Created 2 tasks/);

    const tasks = listTasks(taskListId);
    expect(tasks.map((t) => t.subject)).toEqual(["Do x", "Do y"]);
    expect(tasks.every((t) => t.status === "pending")).toBe(true);
    expect(tasks[0]?.activeForm).toBe("Doing x");
  });

  it("creates no tasks on modify and echoes feedback", async () => {
    const result = await run(async () => ({ action: "modify", feedback: "split step 2" }));
    expect(result.content).toMatch(/split step 2/);
    expect(listTasks(taskListId)).toHaveLength(0);
  });

  it("creates no tasks on reject", async () => {
    const result = await run(async () => ({ action: "reject" }));
    expect(result.content).toMatch(/rejected/i);
    expect(listTasks(taskListId)).toHaveLength(0);
  });
});

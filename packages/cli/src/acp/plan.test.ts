import { describe, expect, it } from "vitest";
import type { Task } from "@luckycli/core";
import { planBodyUpdate, planUpdateFromProposal, planUpdateFromTasks } from "./plan.js";

const tasks: Task[] = [
  { id: "1", subject: "Add the parser", description: "", status: "completed" },
  {
    id: "2",
    subject: "Wire the parser",
    description: "",
    activeForm: "Wiring the parser",
    status: "in_progress",
  },
  { id: "3", subject: "Test it", description: "", status: "pending" },
];

describe("planUpdateFromTasks", () => {
  it("maps statuses one-to-one and prefers activeForm while in progress", () => {
    expect(planUpdateFromTasks("s1", tasks)).toEqual({
      sessionId: "s1",
      update: {
        sessionUpdate: "plan",
        entries: [
          { content: "Add the parser", priority: "medium", status: "completed" },
          { content: "Wiring the parser", priority: "medium", status: "in_progress" },
          { content: "Test it", priority: "medium", status: "pending" },
        ],
      },
    });
  });
});

describe("plan proposal updates", () => {
  const plan = {
    title: "Refactor storage",
    markdown: "1. do a\n2. do b",
    tasks: [
      { subject: "Do a", description: "" },
      { subject: "Do b", description: "" },
    ],
  };

  it("announces proposed tasks as pending entries", () => {
    const update = planUpdateFromProposal("s1", plan);
    expect(update.update).toEqual({
      sessionUpdate: "plan",
      entries: [
        { content: "Do a", priority: "medium", status: "pending" },
        { content: "Do b", priority: "medium", status: "pending" },
      ],
    });
  });

  it("renders the plan body as a readable message chunk", () => {
    const update = planBodyUpdate("s1", plan);
    expect(update.update).toMatchObject({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: expect.stringContaining("## Plan: Refactor storage") },
    });
  });
});

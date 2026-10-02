import React from "react";
import { describe, expect, it } from "vitest";
import type { Task } from "@luckycli/core";
import { renderToScreen, scanPositions } from "../../vendor/ink/render-to-screen.js";
import { THEMES, type Theme } from "../themes.js";
import { TaskPanel } from "./TaskPanel.js";

const theme = THEMES[0] as Theme;

function task(id: string, subject: string, status: Task["status"]): Task {
  return { id, subject, status } as Task;
}

describe("TaskPanel", () => {
  it("shows the checklist while work is in flight", () => {
    const tasks = [task("1", "Read the code", "completed"), task("2", "Fix the menu", "in_progress")];
    const { screen } = renderToScreen(<TaskPanel tasks={tasks} theme={theme} width={80} />, 80);
    expect(scanPositions(screen, "Tasks")).toHaveLength(1);
    expect(scanPositions(screen, "1/2 done")).toHaveLength(1);
    expect(scanPositions(screen, "Fix the menu")).toHaveLength(1);
  });

  it("disappears once every task is completed", () => {
    const tasks = [task("1", "Read the code", "completed"), task("2", "Fix the menu", "completed")];
    const { screen } = renderToScreen(<TaskPanel tasks={tasks} theme={theme} width={80} />, 80);
    expect(scanPositions(screen, "Tasks")).toHaveLength(0);
    expect(scanPositions(screen, "done")).toHaveLength(0);
  });
});

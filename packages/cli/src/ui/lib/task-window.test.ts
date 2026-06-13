import { describe, it, expect } from "vitest";
import type { Task, TaskStatus } from "@luckycli/core";
import { selectTaskWindow, formatHiddenSummary, TASK_WINDOW_SIZE } from "./task-window.js";

function task(id: string, status: TaskStatus): Task {
  return { id, subject: id, status } as Task;
}

describe("selectTaskWindow", () => {
  it("returns everything unchanged when within the window", () => {
    const tasks = [task("a", "completed"), task("b", "pending")];
    const w = selectTaskWindow(tasks);
    expect(w.visible).toEqual(tasks);
    expect(w.hiddenCount).toBe(0);
  });

  it("returns the full list (original order) when limit is 0 (expanded view)", () => {
    const tasks = Array.from({ length: 12 }, (_, i) => task(`t${i}`, "pending"));
    const w = selectTaskWindow(tasks, 0);
    expect(w.visible).toEqual(tasks);
    expect(w.hiddenCount).toBe(0);
  });

  it("prioritizes in_progress then pending, pushing completed out of the window", () => {
    // 6 tasks, window of 5: the lone completed one at the front should be hidden.
    const tasks = [
      task("done1", "completed"),
      task("done2", "completed"),
      task("active", "in_progress"),
      task("p1", "pending"),
      task("p2", "pending"),
      task("p3", "pending"),
    ];
    const w = selectTaskWindow(tasks, 5);
    expect(w.visible.map((t) => t.id)).toEqual(["active", "p1", "p2", "p3", "done1"]);
    expect(w.hiddenCount).toBe(1);
    expect(w.hidden).toEqual({ inProgress: 0, pending: 0, completed: 1 });
  });

  it("keeps original order within a status bucket (stable)", () => {
    const tasks = [
      task("p3", "pending"),
      task("p1", "pending"),
      task("p2", "pending"),
      task("a", "in_progress"),
      task("b", "in_progress"),
      task("c", "pending"),
    ];
    const w = selectTaskWindow(tasks, 5);
    // in_progress first (a,b in their original order), then pending in order.
    expect(w.visible.map((t) => t.id)).toEqual(["a", "b", "p3", "p1", "p2"]);
  });

  it("defaults to a window of TASK_WINDOW_SIZE", () => {
    const tasks = Array.from({ length: 9 }, (_, i) => task(`t${i}`, "pending"));
    const w = selectTaskWindow(tasks);
    expect(w.visible).toHaveLength(TASK_WINDOW_SIZE);
    expect(w.hiddenCount).toBe(9 - TASK_WINDOW_SIZE);
  });
});

describe("formatHiddenSummary", () => {
  it("lists only non-zero buckets in priority order", () => {
    expect(formatHiddenSummary({ inProgress: 1, pending: 3, completed: 2 })).toBe(
      "1 in progress, 3 pending, 2 completed",
    );
    expect(formatHiddenSummary({ inProgress: 0, pending: 4, completed: 0 })).toBe("4 pending");
    expect(formatHiddenSummary({ inProgress: 0, pending: 0, completed: 0 })).toBe("");
  });
});

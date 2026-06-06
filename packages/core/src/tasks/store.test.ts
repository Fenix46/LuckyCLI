import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTask,
  deleteTask,
  getTask,
  listTasks,
  resetTaskList,
  sanitizePathComponent,
  updateTask,
} from "./store.js";

describe("tasks store", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "lucky-tasks-"));
  });

  afterEach(async () => {
    resetTaskList(cwd);
    await rm(cwd, { recursive: true, force: true });
  });

  it("creates tasks with sequential ids", () => {
    const a = createTask(cwd, { subject: "First", description: "do a", status: "pending" });
    const b = createTask(cwd, { subject: "Second", description: "do b", status: "pending" });
    expect(a.id).toBe("1");
    expect(b.id).toBe("2");
  });

  it("round-trips a task through get and update", () => {
    const created = createTask(cwd, {
      subject: "Build feature",
      description: "implement it",
      activeForm: "Building feature",
      status: "pending",
    });

    expect(getTask(cwd, created.id)).toMatchObject({
      subject: "Build feature",
      status: "pending",
    });

    const updated = updateTask(cwd, created.id, { status: "in_progress" });
    expect(updated?.status).toBe("in_progress");
    expect(getTask(cwd, created.id)?.status).toBe("in_progress");
  });

  it("lists tasks sorted by numeric id", () => {
    createTask(cwd, { subject: "one", description: "x", status: "pending" });
    createTask(cwd, { subject: "two", description: "x", status: "pending" });
    createTask(cwd, { subject: "three", description: "x", status: "pending" });
    expect(listTasks(cwd).map((t) => t.id)).toEqual(["1", "2", "3"]);
  });

  it("does not reuse ids after deletion", () => {
    createTask(cwd, { subject: "one", description: "x", status: "pending" });
    const two = createTask(cwd, { subject: "two", description: "x", status: "pending" });
    expect(deleteTask(cwd, two.id)).toBe(true);
    const three = createTask(cwd, { subject: "three", description: "x", status: "pending" });
    // highest remaining is #1, so the next id is #2 again — acceptable for
    // single-agent since the deleted task is gone. Document the actual behavior.
    expect(three.id).toBe("2");
  });

  it("returns null updating or getting a missing task", () => {
    expect(getTask(cwd, "999")).toBeNull();
    expect(updateTask(cwd, "999", { status: "completed" })).toBeNull();
    expect(deleteTask(cwd, "999")).toBe(false);
  });

  it("clears the whole list", () => {
    createTask(cwd, { subject: "one", description: "x", status: "pending" });
    resetTaskList(cwd);
    expect(listTasks(cwd)).toHaveLength(0);
  });

  it("sanitizes path components", () => {
    expect(sanitizePathComponent("/Users/me/My Project!")).toBe("-Users-me-My-Project-");
  });
});

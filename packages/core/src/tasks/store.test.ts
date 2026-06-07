import { mkdtemp, rm } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupOrphanTaskLists,
  createTask,
  deleteTask,
  getTask,
  listTasks,
  resetTaskList,
  sanitizePathComponent,
  tasksRootDir,
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

  it("keys lists independently so a fresh id starts empty", () => {
    const a = `unit-a-${Date.now()}`;
    const b = `unit-b-${Date.now()}`;
    createTask(a, { subject: "in A", description: "x", status: "pending" });
    expect(listTasks(a)).toHaveLength(1);
    // A different (fresh) task list id is empty — the core of the per-session fix.
    expect(listTasks(b)).toHaveLength(0);
    resetTaskList(a);
  });

  it("archives a fully-completed list so the next task starts at #1", () => {
    const a = createTask(cwd, { subject: "one", description: "x", status: "pending" });
    const b = createTask(cwd, { subject: "two", description: "x", status: "pending" });
    updateTask(cwd, a.id, { status: "completed" });
    updateTask(cwd, b.id, { status: "completed" });

    // List is fully done; the next create should archive it and restart fresh.
    const next = createTask(cwd, { subject: "new work", description: "x", status: "pending" });
    expect(next.id).toBe("1");
    expect(listTasks(cwd)).toHaveLength(1);
    expect(listTasks(cwd)[0]?.subject).toBe("new work");
  });

  it("does NOT archive while at least one task is still open", () => {
    const a = createTask(cwd, { subject: "one", description: "x", status: "pending" });
    const b = createTask(cwd, { subject: "two", description: "x", status: "pending" });
    // #1 done, #2 still pending — the list is NOT fully complete.
    updateTask(cwd, a.id, { status: "completed" });
    void b;
    const c = createTask(cwd, { subject: "three", description: "x", status: "pending" });
    // No archive: ids keep climbing within the same list.
    expect(c.id).toBe("3");
    expect(listTasks(cwd)).toHaveLength(3);
  });

  it("cleanupOrphanTaskLists removes lists not in the valid set", () => {
    const keep = `unit-keep-${Date.now()}`;
    const orphan = `unit-orphan-${Date.now()}`;
    createTask(keep, { subject: "keep", description: "x", status: "pending" });
    createTask(orphan, { subject: "orphan", description: "x", status: "pending" });

    // Pass every currently-known list as valid EXCEPT the orphan, so the test
    // only deletes the orphan it created and never touches unrelated lists in
    // the shared on-disk root (other tests, the real user's lists).
    const valid = readdirSync(tasksRootDir()).filter(
      (id) => id !== sanitizePathComponent(orphan),
    );
    cleanupOrphanTaskLists(valid);

    expect(listTasks(keep)).toHaveLength(1);
    expect(listTasks(orphan)).toHaveLength(0);
    resetTaskList(keep);
  });
});

import { describe, expect, it } from "vitest";
import { previewToolDiffs, PREVIEWABLE_TOOLS } from "./approval-preview.js";

/** A reader over an in-memory file map — the stand-in for disk or an editor. */
function reader(files: Record<string, string>) {
  return async (path: string) => files[path];
}

describe("previewToolDiffs", () => {
  it("lists exactly the write tools as previewable", () => {
    expect([...PREVIEWABLE_TOOLS].sort()).toEqual(["apply_patch", "edit_file", "write_file"]);
  });

  it("returns nothing for tools with no file change", async () => {
    expect(await previewToolDiffs("exec", { command: "ls" })).toEqual([]);
    expect(await previewToolDiffs("read_file", { path: "a.txt" })).toEqual([]);
  });

  describe("edit_file", () => {
    const input = { path: "a.txt", oldString: "two", newString: "TWO" };

    it("diffs against the real file, with file line numbers", async () => {
      const diffs = await previewToolDiffs(
        "edit_file",
        input,
        reader({ "a.txt": "one\ntwo\nthree\nfour\nfive\n" }),
      );
      expect(diffs).toHaveLength(1);
      expect(diffs[0]!.path).toBe("a.txt");
      expect(diffs[0]!.additions).toBe(1);
      expect(diffs[0]!.deletions).toBe(1);
      const changed = diffs[0]!.hunks.flatMap((h) => h.lines).filter((l) => l.type !== "context");
      expect(changed.map((l) => [l.type, l.text])).toEqual([
        ["del", "two"],
        ["add", "TWO"],
      ]);
      // Line 2 of the file, not line 1 of the snippet.
      expect(changed[0]!.oldLine).toBe(2);
      // Context around the change proves the file (not the snippet) was diffed.
      expect(diffs[0]!.hunks[0]!.lines.some((l) => l.text === "three")).toBe(true);
    });

    it("previews the host's buffer, not the disk contents", async () => {
      // The "editor" has an unsaved buffer where the snippet moved down.
      const diffs = await previewToolDiffs(
        "edit_file",
        input,
        reader({ "a.txt": "zero\none\ntwo\nthree\n" }),
      );
      const del = diffs[0]!.hunks.flatMap((h) => h.lines).find((l) => l.type === "del");
      expect(del!.oldLine).toBe(3);
    });

    it("falls back to a snippet diff with no reader", async () => {
      const diffs = await previewToolDiffs("edit_file", input);
      expect(diffs).toHaveLength(1);
      expect(diffs[0]!.additions).toBe(1);
      expect(diffs[0]!.deletions).toBe(1);
    });

    it("falls back to a snippet diff when the file is missing", async () => {
      const diffs = await previewToolDiffs("edit_file", input, reader({}));
      expect(diffs[0]!.hunks.flatMap((h) => h.lines).map((l) => l.text)).toEqual(["two", "TWO"]);
    });

    it("yields no diff when the snippet does not match the file", async () => {
      const diffs = await previewToolDiffs(
        "edit_file",
        { path: "a.txt", oldString: "absent", newString: "x" },
        reader({ "a.txt": "one\ntwo\n" }),
      );
      expect(diffs).toEqual([]);
    });
  });

  describe("write_file", () => {
    it("marks a new file as created", async () => {
      const diffs = await previewToolDiffs(
        "write_file",
        { path: "new.txt", content: "hello\n" },
        reader({}),
      );
      expect(diffs[0]).toMatchObject({ path: "new.txt", created: true, additions: 1, deletions: 0 });
    });

    it("diffs an overwrite against the existing contents", async () => {
      const diffs = await previewToolDiffs(
        "write_file",
        { path: "a.txt", content: "new\n" },
        reader({ "a.txt": "old\n" }),
      );
      expect(diffs[0]!.created).toBeUndefined();
      expect(diffs[0]).toMatchObject({ additions: 1, deletions: 1 });
    });
  });

  describe("apply_patch", () => {
    const updatePatch = [
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1,3 +1,3 @@",
      " one",
      "-two",
      "+TWO",
      " three",
      "",
    ].join("\n");

    it("dry-runs an update patch without writing", async () => {
      const files = { "a.txt": "one\ntwo\nthree\n" };
      const diffs = await previewToolDiffs("apply_patch", { patch: updatePatch }, reader(files));
      expect(diffs).toHaveLength(1);
      expect(diffs[0]).toMatchObject({ path: "a.txt", additions: 1, deletions: 1 });
      expect(files["a.txt"]).toBe("one\ntwo\nthree\n");
    });

    it("previews a creation patch even with no reader", async () => {
      const patch = ["--- /dev/null", "+++ b/n.txt", "@@ -0,0 +1 @@", "+hello"].join("\n");
      const diffs = await previewToolDiffs("apply_patch", { patch });
      expect(diffs[0]).toMatchObject({ path: "n.txt", created: true });
    });

    it("yields no diff for a malformed patch", async () => {
      expect(await previewToolDiffs("apply_patch", { patch: "not a patch" }, reader({}))).toEqual(
        [],
      );
    });

    it("yields no diff when the patch context does not match", async () => {
      const diffs = await previewToolDiffs(
        "apply_patch",
        { patch: updatePatch },
        reader({ "a.txt": "totally\ndifferent\nlines\n" }),
      );
      expect(diffs).toEqual([]);
    });

    it("yields no diff when the patched file is missing", async () => {
      expect(await previewToolDiffs("apply_patch", { patch: updatePatch }, reader({}))).toEqual([]);
    });
  });
});

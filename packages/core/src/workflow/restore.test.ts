import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSnapshot } from "./snapshot.js";
import { restoreSnapshot, RestoreConflictError } from "./restore.js";

describe("workflow snapshot restore", () => {
  let root: string;
  let outside: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "lucky-restore-"));
    outside = await mkdtemp(join(tmpdir(), "lucky-restore-outside-"));
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "index.ts"), "before\n");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it("restores modified, deleted and newly-created files", async () => {
    const checkpoint = await createSnapshot(root, ["src/index.ts", "new.txt"], {
      id: "checkpoint-restore-1",
      sessionId: "session-1",
    });
    await writeFile(join(root, "src", "index.ts"), "after\n");
    await writeFile(join(root, "new.txt"), "created later\n");

    const result = await restoreSnapshot(root, checkpoint, "force");

    expect(result.restored).toEqual(["new.txt", "src/index.ts"]);
    expect(result.conflicts).toEqual([
      { path: "new.txt", reason: "modified" },
      { path: "src/index.ts", reason: "modified" },
    ]);
    await expect(readFile(join(root, "src", "index.ts"), "utf8")).resolves.toBe("before\n");
    await expect(readFile(join(root, "new.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("aborts before changing any file when a conflict exists", async () => {
    const checkpoint = await createSnapshot(root, ["src/index.ts"], {
      id: "checkpoint-restore-2",
      sessionId: "session-1",
    });
    await writeFile(join(root, "src", "index.ts"), "external change\n");

    await expect(restoreSnapshot(root, checkpoint)).rejects.toBeInstanceOf(RestoreConflictError);
    await expect(readFile(join(root, "src", "index.ts"), "utf8")).resolves.toBe("external change\n");
  });

  it("force restores explicit conflicts and is idempotent afterward", async () => {
    const checkpoint = await createSnapshot(root, ["src/index.ts"], {
      id: "checkpoint-restore-3",
      sessionId: "session-1",
    });
    await writeFile(join(root, "src", "index.ts"), "external change\n");

    const forced = await restoreSnapshot(root, checkpoint, "force");
    const repeated = await restoreSnapshot(root, checkpoint);

    expect(forced.conflicts).toEqual([{ path: "src/index.ts", reason: "modified" }]);
    expect(repeated.unchanged).toEqual(["src/index.ts"]);
  });

  it("reports missing files and preserves executable mode", async () => {
    await writeFile(join(root, "run.sh"), "#!/bin/sh\n");
    await chmod(join(root, "run.sh"), 0o755);
    const checkpoint = await createSnapshot(root, ["run.sh"], {
      id: "checkpoint-restore-4",
      sessionId: "session-1",
    });
    await rm(join(root, "run.sh"));

    await expect(restoreSnapshot(root, checkpoint)).rejects.toMatchObject({
      conflicts: [{ path: "run.sh", reason: "missing" }],
    });
    await restoreSnapshot(root, checkpoint, "force");
    await expect(readFile(join(root, "run.sh"), "utf8")).resolves.toBe("#!/bin/sh\n");
  });

  it("does not follow a symlink during restore", async () => {
    await writeFile(join(outside, "secret.txt"), "keep me\n");
    const checkpoint = await createSnapshot(root, ["src/index.ts"], {
      id: "checkpoint-restore-5",
      sessionId: "session-1",
    });
    await rm(join(root, "src", "index.ts"));
    await symlink(join(outside, "secret.txt"), join(root, "src", "index.ts"));

    await expect(restoreSnapshot(root, checkpoint)).rejects.toMatchObject({
      conflicts: [{ path: "src/index.ts", reason: "symlink" }],
    });
    await expect(readFile(join(outside, "secret.txt"), "utf8")).resolves.toBe("keep me\n");
  });
});

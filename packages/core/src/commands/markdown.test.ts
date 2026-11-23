import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  discoverMarkdownCommands,
  expandMarkdownCommand,
  globalCommandRoots,
  projectCommandRoots,
  splitArguments,
} from "./markdown.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "lucky-commands-"));
  temps.push(dir);
  return dir;
}

function writeCommand(root: string, name: string, content: string): string {
  const path = join(root, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  return path;
}

describe("command roots", () => {
  it("orders the project and global roots lucky first", () => {
    expect(projectCommandRoots("/repo")).toEqual([
      "/repo/.lucky/commands",
      "/repo/.claude/commands",
    ]);
    expect(globalCommandRoots("/home/u")).toEqual([
      "/home/u/.luckycli/commands",
      "/home/u/.claude/commands",
    ]);
  });
});

describe("discoverMarkdownCommands", () => {
  it("namespaces subdirectories and reads frontmatter", () => {
    const cwd = temp();
    const home = temp();
    const file = writeCommand(
      join(cwd, ".lucky", "commands"),
      "db/migrate.md",
      `---\ndescription: Run a database migration\nargument-hint: <name>\n---\nMigrate to $1.`,
    );

    const [command] = discoverMarkdownCommands({ cwd, home });
    expect(command).toEqual({
      name: "db:migrate",
      description: "Run a database migration",
      argumentHint: "<name>",
      body: "Migrate to $1.",
      file,
      scope: "project",
      origin: "lucky",
    });
  });

  it("accepts a plain markdown file without frontmatter", () => {
    const cwd = temp();
    const home = temp();
    writeCommand(join(cwd, ".claude", "commands"), "deploy.md", "Deploy the app.");

    const [command] = discoverMarkdownCommands({ cwd, home });
    expect(command?.name).toBe("deploy");
    expect(command?.description).toBe("");
    expect(command?.body).toBe("Deploy the app.");
    expect(command?.origin).toBe("claude");
  });

  it("shadows global commands with project ones and lucky over claude", () => {
    const cwd = temp();
    const home = temp();
    writeCommand(join(home, ".claude", "commands"), "review.md", "global claude");
    writeCommand(join(home, ".luckycli", "commands"), "review.md", "global lucky");
    writeCommand(join(cwd, ".claude", "commands"), "review.md", "project claude");
    writeCommand(join(cwd, ".lucky", "commands"), "review.md", "project lucky");

    const [command] = discoverMarkdownCommands({ cwd, home });
    expect(command?.body).toBe("project lucky");
    expect(command?.origin).toBe("lucky");
    expect(command?.scope).toBe("project");
  });

  it("skips malformed frontmatter, invalid names and ignored directories", () => {
    const cwd = temp();
    const home = temp();
    const root = join(cwd, ".lucky", "commands");
    writeCommand(root, "broken.md", "---\ndescription: x\n");
    writeCommand(root, "bad name.md", "body");
    writeCommand(root, "node_modules/skip.md", "body");
    writeCommand(root, "nested/ok.md", "body");

    expect(discoverMarkdownCommands({ cwd, home }).map((c) => c.name)).toEqual(["nested:ok"]);
  });
});

describe("splitArguments", () => {
  it("honors quotes and escapes", () => {
    expect(splitArguments("one two")).toEqual(["one", "two"]);
    expect(splitArguments(`"two words" 'three words'`)).toEqual(["two words", "three words"]);
    expect(splitArguments("a\\ b c")).toEqual(["a b", "c"]);
    expect(splitArguments("  ")).toEqual([]);
  });
});

describe("expandMarkdownCommand", () => {
  it("substitutes $ARGUMENTS and positional arguments", () => {
    expect(expandMarkdownCommand({ body: "Review: $ARGUMENTS" }, "a b")).toBe("Review: a b");
    expect(expandMarkdownCommand({ body: "From $1 to $2" }, "one two")).toBe("From one to two");
    expect(expandMarkdownCommand({ body: "Missing $3" }, "one two")).toBe("Missing ");
  });

  it("appends arguments when the body has no placeholder", () => {
    expect(expandMarkdownCommand({ body: "Do the thing." }, "extra context")).toBe(
      "Do the thing.\n\nextra context",
    );
    expect(expandMarkdownCommand({ body: "Do the thing." }, "")).toBe("Do the thing.");
  });
});

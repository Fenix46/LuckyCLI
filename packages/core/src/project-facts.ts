import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Cheap, synchronous facts about the project in the working directory, read
 * once when the system prompt is composed: how to build, test and lint it and
 * where git stands. They save the model the exploratory turns it would
 * otherwise spend discovering the toolchain, and steer it to the project's own
 * commands instead of guessed ones.
 */
export interface ProjectFacts {
  /** e.g. "npm", "pnpm", "cargo", "go", "python". */
  toolchain?: string;
  /** Workspace globs of a JS monorepo. */
  workspaces?: string[];
  /** Named commands in a stable order: typecheck, test, build, lint, dev, start. */
  commands: Array<{ name: string; command: string }>;
  git?: {
    branch: string;
    /** Changed or untracked paths at session start. */
    changes: number;
  };
}

const SCRIPT_ORDER = ["typecheck", "test", "build", "lint", "format", "dev", "start"] as const;
const MAKE_TARGETS = ["test", "build", "lint", "check"] as const;
// git must never stall prompt composition on a huge or network-mounted repo.
const GIT_TIMEOUT_MS = 1_500;

export function detectProjectFacts(cwd: string): ProjectFacts {
  const facts: ProjectFacts = { commands: [] };
  const pkg = readJson(join(cwd, "package.json"));

  if (pkg) {
    const pm = detectPackageManager(cwd, pkg.packageManager);
    facts.toolchain = pm;
    const workspaces = readWorkspaces(pkg.workspaces);
    if (workspaces.length > 0) facts.workspaces = workspaces;
    const scripts = pkg.scripts && typeof pkg.scripts === "object" ? (pkg.scripts as Record<string, unknown>) : {};
    for (const name of SCRIPT_ORDER) {
      if (typeof scripts[name] !== "string") continue;
      facts.commands.push({ name, command: name === "test" && pm === "npm" ? "npm test" : `${pm} run ${name}` });
    }
  } else if (existsSync(join(cwd, "Cargo.toml"))) {
    facts.toolchain = "cargo";
    facts.commands.push(
      { name: "check", command: "cargo check" },
      { name: "test", command: "cargo test" },
      { name: "build", command: "cargo build" },
      { name: "lint", command: "cargo clippy" },
    );
  } else if (existsSync(join(cwd, "go.mod"))) {
    facts.toolchain = "go";
    facts.commands.push(
      { name: "test", command: "go test ./..." },
      { name: "build", command: "go build ./..." },
      { name: "lint", command: "go vet ./..." },
    );
  } else if (existsSync(join(cwd, "pyproject.toml")) || existsSync(join(cwd, "requirements.txt"))) {
    const runner = existsSync(join(cwd, "uv.lock"))
      ? "uv run "
      : existsSync(join(cwd, "poetry.lock"))
        ? "poetry run "
        : "";
    facts.toolchain = runner ? runner.split(" ")[0] ?? "python" : "python";
    facts.commands.push({ name: "test", command: `${runner}pytest` });
  } else if (existsSync(join(cwd, "gradlew"))) {
    facts.toolchain = "gradle";
    facts.commands.push({ name: "test", command: "./gradlew test" }, { name: "build", command: "./gradlew build" });
  } else if (existsSync(join(cwd, "pom.xml"))) {
    facts.toolchain = "maven";
    facts.commands.push({ name: "test", command: "mvn test" }, { name: "build", command: "mvn package" });
  }

  if (facts.commands.length === 0) {
    for (const target of makeTargets(cwd)) facts.commands.push({ name: target, command: `make ${target}` });
    if (facts.commands.length > 0) facts.toolchain ??= "make";
  }

  const git = readGit(cwd);
  if (git) facts.git = git;
  return facts;
}

/** The "# Project" prompt block, or null when nothing useful was detected. */
export function renderProjectFacts(facts: ProjectFacts): string | null {
  const lines: string[] = [];
  if (facts.toolchain) {
    const ws = facts.workspaces?.length ? ` (monorepo, workspaces: ${facts.workspaces.join(", ")})` : "";
    lines.push(`- Toolchain: ${facts.toolchain}${ws}`);
  }
  if (facts.commands.length > 0) {
    lines.push(`- Commands: ${facts.commands.map((c) => `${c.name} \`${c.command}\``).join(" · ")}`);
  }
  if (facts.git) {
    const state = facts.git.changes === 0 ? "clean" : `${facts.git.changes} changed or untracked paths`;
    lines.push(`- Git: branch ${facts.git.branch}, ${state} (at session start)`);
  }
  if (lines.length === 0) return null;
  const guidance =
    facts.commands.length > 0
      ? "\n\nUse these commands to build and verify your changes rather than inventing new ones. Prefer the narrowest one that proves the change (typecheck or a targeted test before a full build)."
      : "";
  return `# Project\n\n${lines.join("\n")}${guidance}`;
}

function detectPackageManager(cwd: string, declared: unknown): string {
  if (typeof declared === "string") {
    const name = declared.split("@")[0];
    if (name === "pnpm" || name === "yarn" || name === "bun" || name === "npm") return name;
  }
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  if (existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bun.lock"))) return "bun";
  return "npm";
}

function readWorkspaces(value: unknown): string[] {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { packages?: unknown }).packages)
      ? (value as { packages: unknown[] }).packages
      : [];
  return list.filter((item): item is string => typeof item === "string").slice(0, 8);
}

function makeTargets(cwd: string): string[] {
  const makefile = ["Makefile", "makefile", "GNUmakefile"].map((name) => join(cwd, name)).find(existsSync);
  if (!makefile) return [];
  let text: string;
  try {
    text = readFileSync(makefile, "utf8");
  } catch {
    return [];
  }
  return MAKE_TARGETS.filter((target) => new RegExp(`^${target}\\s*:`, "m").test(text));
}

function readGit(cwd: string): ProjectFacts["git"] | undefined {
  try {
    const run = (args: string[]) =>
      execFileSync("git", args, { cwd, timeout: GIT_TIMEOUT_MS, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const branch = run(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
    if (!branch) return undefined;
    const status = run(["status", "--porcelain"]);
    const changes = status.split("\n").filter((line) => line.trim()).length;
    return { branch, changes };
  } catch {
    return undefined;
  }
}

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

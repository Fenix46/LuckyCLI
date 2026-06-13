import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOOL_PERMISSION_POLICY,
  commandPrefix,
  matchesWildcard,
  parseToolPermissionPolicyEnv,
  resolveToolPermission,
} from "./permissions.js";

describe("commandPrefix", () => {
  it("extracts command + word subcommand", () => {
    expect(commandPrefix("git status")).toBe("git status");
    expect(commandPrefix("git status -s --porcelain")).toBe("git status");
    expect(commandPrefix("git commit -m 'x'")).toBe("git commit");
    expect(commandPrefix("npm run build")).toBe("npm run");
    expect(commandPrefix("docker compose up -d")).toBe("docker compose");
  });

  it("treats a short flag as the subcommand only for flag-selected programs", () => {
    expect(commandPrefix("python -m py_compile a.py")).toBe("python -m");
    expect(commandPrefix("python3 -c 'print(1)'")).toBe("python3 -c");
    expect(commandPrefix("node -e 'x'")).toBe("node -e");
    // Not whitelisted: a bare flag must NOT become a prefix.
    expect(commandPrefix("ls -la")).toBeNull();
    expect(commandPrefix("rm -rf build")).toBeNull();
  });

  it("skips leading env-var assignments", () => {
    expect(commandPrefix("NODE_ENV=prod npm run build")).toBe("npm run");
    expect(commandPrefix("FOO=1 BAR=2 git push")).toBe("git push");
  });

  it("returns null when there's no clear subcommand (falls back to exact)", () => {
    expect(commandPrefix("ls -la")).toBeNull(); // flag, not a subcommand
    expect(commandPrefix("cat file.txt")).toBeNull(); // filename
    expect(commandPrefix("chmod 755 file")).toBeNull(); // number
    expect(commandPrefix("ls")).toBeNull(); // single token
    expect(commandPrefix("./script.sh arg")).toBeNull(); // path program
  });

  it("matches different args of the same prefix to one scope", () => {
    expect(commandPrefix("git status -s")).toBe(commandPrefix("git status --porcelain"));
    expect(commandPrefix("python -m py_compile a.py")).toBe(
      commandPrefix("python -m py_compile b.py"),
    );
  });
});

describe("tool permissions", () => {
  it("resolves exact rules before wildcard rules", () => {
    expect(resolveToolPermission({ "*": "deny", exec: "ask" }, "exec")).toBe("ask");
  });

  it("asks before running side-effecting built-in command tools", () => {
    expect(resolveToolPermission(DEFAULT_TOOL_PERMISSION_POLICY, "exec")).toBe("ask");
    expect(resolveToolPermission(DEFAULT_TOOL_PERMISSION_POLICY, "PowerShell")).toBe("ask");
    expect(resolveToolPermission(DEFAULT_TOOL_PERMISSION_POLICY, "project_memory")).toBe("ask");
  });

  it("uses the longest matching wildcard", () => {
    expect(resolveToolPermission({ "mcp_*": "ask", "mcp_github_*": "allow" }, "mcp_github_search")).toBe("allow");
  });

  it("falls back to readonly allow and side-effect ask for explicit empty policies", () => {
    expect(resolveToolPermission({}, "custom_read", true)).toBe("allow");
    expect(resolveToolPermission({}, "custom_write", false)).toBe("ask");
  });

  it("keeps programmatic agent use backward-compatible without a policy", () => {
    expect(resolveToolPermission(undefined, "custom_write", false)).toBe("allow");
  });

  it("parses env policies", () => {
    expect(parseToolPermissionPolicyEnv("exec=deny,apply_patch:allow,mcp_*=ask")).toEqual({
      exec: "deny",
      apply_patch: "allow",
      "mcp_*": "ask",
    });
  });

  it("matches wildcard patterns", () => {
    expect(matchesWildcard("mcp_*", "mcp_github_search")).toBe(true);
    expect(matchesWildcard("*_search", "web_search")).toBe(true);
    expect(matchesWildcard("mcp_*", "web_search")).toBe(false);
  });
});

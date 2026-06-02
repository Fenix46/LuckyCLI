import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOOL_PERMISSION_POLICY,
  matchesWildcard,
  parseToolPermissionPolicyEnv,
  resolveToolPermission,
} from "./permissions.js";

describe("tool permissions", () => {
  it("resolves exact rules before wildcard rules", () => {
    expect(resolveToolPermission({ "*": "deny", exec: "ask" }, "exec")).toBe("ask");
  });

  it("asks before running side-effecting built-in command tools", () => {
    expect(resolveToolPermission(DEFAULT_TOOL_PERMISSION_POLICY, "exec")).toBe("ask");
    expect(resolveToolPermission(DEFAULT_TOOL_PERMISSION_POLICY, "PowerShell")).toBe("ask");
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

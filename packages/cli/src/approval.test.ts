import { describe, expect, it } from "vitest";
import { describeAlwaysScope, requiresApprovalInAutoMode } from "./approval.js";
import { nextPermissionMode } from "./ui/lib/requests.js";

describe("requiresApprovalInAutoMode", () => {
  it("auto-approves ordinary shell commands and non-shell tools", () => {
    expect(requiresApprovalInAutoMode("exec", { command: "npm test" })).toBe(false);
    expect(requiresApprovalInAutoMode("write_file", { path: "a.ts", content: "" })).toBe(false);
    expect(requiresApprovalInAutoMode("mcp__server__tool", {})).toBe(false);
  });

  it("still asks for shell calls that opt into destructive commands", () => {
    expect(requiresApprovalInAutoMode("exec", { command: "rm -rf dist", allowDangerous: true })).toBe(true);
    expect(requiresApprovalInAutoMode("PowerShell", { command: "Remove-Item x", allowDangerous: true })).toBe(true);
  });

  it("tolerates malformed input", () => {
    expect(requiresApprovalInAutoMode("exec", null)).toBe(false);
    expect(requiresApprovalInAutoMode("exec", { allowDangerous: "true" })).toBe(false);
  });
});

describe("nextPermissionMode", () => {
  it("cycles normal → acceptEdits → auto → normal", () => {
    expect(nextPermissionMode("normal")).toBe("acceptEdits");
    expect(nextPermissionMode("acceptEdits")).toBe("auto");
    expect(nextPermissionMode("auto")).toBe("normal");
  });
});

describe("describeAlwaysScope", () => {
  it("names the remembered command prefix, the exact command, or the tool", () => {
    expect(describeAlwaysScope("exec", { command: "git status --short" })).toBe(
      "Don't ask again for `git status` commands this session",
    );
    expect(describeAlwaysScope("exec", { command: "ls -la" })).toBe(
      "Don't ask again for this exact command this session",
    );
    expect(describeAlwaysScope("write_file", { path: "a.ts" })).toBe(
      "Don't ask again for write_file this session",
    );
  });
});

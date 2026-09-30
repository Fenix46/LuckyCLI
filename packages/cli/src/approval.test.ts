import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  approvalScope,
  describeAlwaysScope,
  loadCommandRules,
  requiresApprovalInAutoMode,
  shellCommandVerdict,
} from "./approval.js";
import { nextPermissionMode } from "./ui/lib/requests.js";

const cwd = tmpdir();

describe("shellCommandVerdict", () => {
  it("only judges shell tools", () => {
    expect(shellCommandVerdict("write_file", { path: "a.ts" }, cwd, {})).toBeUndefined();
    expect(shellCommandVerdict("exec", null, cwd, {})).toBeUndefined();
  });

  it("asks for risky commands and for any allowDangerous call", () => {
    expect(shellCommandVerdict("exec", { command: "git push" }, cwd, {})).toMatchObject({ action: "ask" });
    expect(
      shellCommandVerdict("exec", { command: "rm -rf dist", allowDangerous: true }, cwd, { allow: ["rm"] }),
    ).toMatchObject({ action: "ask", byRule: false });
    expect(shellCommandVerdict("PowerShell", { command: "Get-ChildItem" }, cwd, {})).toMatchObject({ action: "allow" });
  });

  it("applies the user's rules", () => {
    const rules = { allow: ["git push"], deny: ["npm publish"] };
    expect(shellCommandVerdict("exec", { command: "git push" }, cwd, rules)).toMatchObject({ action: "allow", byRule: true });
    expect(shellCommandVerdict("exec", { command: "npm publish" }, cwd, rules)).toMatchObject({ action: "deny" });
  });
});

describe("requiresApprovalInAutoMode", () => {
  it("asks only when the command policy says so", () => {
    expect(requiresApprovalInAutoMode(undefined)).toBe(false);
    expect(requiresApprovalInAutoMode({ action: "allow", byRule: false })).toBe(false);
    expect(requiresApprovalInAutoMode({ action: "ask", reason: "pushes", byRule: false })).toBe(true);
  });
});

describe("loadCommandRules", () => {
  it("reads LUCKY_COMMAND_RULES and ignores a malformed value", () => {
    expect(loadCommandRules({ LUCKY_COMMAND_RULES: "deny=git push" }).deny).toContain("git push");
    expect(() => loadCommandRules({ LUCKY_COMMAND_RULES: "nope=x" })).not.toThrow();
  });
});

describe("nextPermissionMode", () => {
  it("cycles normal → acceptEdits → auto → normal", () => {
    expect(nextPermissionMode("normal")).toBe("acceptEdits");
    expect(nextPermissionMode("acceptEdits")).toBe("auto");
    expect(nextPermissionMode("auto")).toBe("normal");
  });
});

describe("approval scopes", () => {
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

  it("remembers a risky command exactly, never by prefix", () => {
    expect(approvalScope("exec", { command: "npm run test" })).toBe("exec:npm run");
    expect(approvalScope("exec", { command: "npm run deploy" }, true)).toBe("exec:exact:npm run deploy");
    expect(approvalScope("PowerShell", { command: "git push" }, true)).toBe("PowerShell:exact:git push");
    expect(describeAlwaysScope("exec", { command: "git push origin main" }, true)).toBe(
      "Don't ask again for this exact command this session",
    );
  });
});

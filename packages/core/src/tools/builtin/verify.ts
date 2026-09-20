import { z } from "zod";
import {
  runVerification,
  type RunVerificationOptions,
} from "../../workflow/verify.js";
import { defineTool } from "../types.js";

const verificationInput = z.object({
  timeoutMs: z.number().int().positive().max(600_000).optional(),
  maxOutputChars: z.number().int().positive().max(1_000_000).optional(),
});

export const verifyTool = defineTool({
  name: "verify",
  description:
    "Run the project's trusted typecheck, test, build, or language-specific checks. " +
    "Use after approved edits to validate the current working tree.",
  schema: verificationInput,
  readonly: true,
  async execute({ timeoutMs, maxOutputChars }, ctx) {
    const result = await runVerification(ctx.cwd, [], {
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(maxOutputChars !== undefined ? { maxOutputChars } : {}),
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    } satisfies RunVerificationOptions);
    const summary = result.checks.length === 0
      ? "No trusted verification checks were found."
      : result.checks
        .map((check) => `${check.id}: ${check.status}${check.exitCode !== undefined && check.exitCode !== null ? ` (exit ${check.exitCode})` : ""}`)
        .join("\n");
    return {
      content: `Verification ${result.status}.\n${summary}`,
      ...(result.status === "failed" || result.status === "cancelled" ? { isError: true } : {}),
    };
  },
});

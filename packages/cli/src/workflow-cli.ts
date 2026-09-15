import { buildReviewPrompt, collectReviewDiff, parseReviewResponse, resolveConfig, runVerification, type Agent, type ResolvedConfig } from "@luckycli/core";
import { buildAgent } from "./runtime.js";
import { formatMachineEvent, parseOutputFormat, type OutputFormat } from "./output.js";

interface WorkflowCliIO {
  out?: (text: string) => void;
  err?: (text: string) => void;
  resolve?: (flags: { provider?: string; model?: string }) => ResolvedConfig;
  build?: (config: ResolvedConfig) => Agent;
}

export async function runVerifyCommand(args: string[], io: WorkflowCliIO = {}): Promise<number> {
  const out = io.out ?? ((text: string) => process.stdout.write(text));
  const err = io.err ?? ((text: string) => process.stderr.write(text));
  let format: OutputFormat = "text";
  try { format = parseOutputFormat(option(args, "--format") ?? option(args, "-f")); } catch (error) {
    err(`${error instanceof Error ? error.message : String(error)}\n`); return 1;
  }
  try {
    const result = await runVerification(process.cwd());
    if (format === "text") out(`${result.status} (${result.checks.length} checks)\n`);
    else if (format === "json") out(`${formatMachineEvent({ type: "result", command: "verify", status: result.status, result })}\n`);
    else {
      for (const check of result.checks) out(`${formatMachineEvent({ type: "status", command: "verify", id: check.id, status: check.status })}\n`);
      out(`${formatMachineEvent({ type: "result", command: "verify", status: result.status })}\n`);
    }
    return result.status === "passed" ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (format === "text") err(`${message}\n`); else out(`${formatMachineEvent({ type: "error", command: "verify", message })}\n`);
    return 1;
  }
}

export async function runReviewCommand(args: string[], io: WorkflowCliIO = {}): Promise<number> {
  const out = io.out ?? ((text: string) => process.stdout.write(text));
  const err = io.err ?? ((text: string) => process.stderr.write(text));
  const format = parseOutputFormat(option(args, "--format") ?? option(args, "-f"));
  const source = args.includes("head") ? "head" as const : "unstaged" as const;
  try {
    const diff = await collectReviewDiff({ cwd: process.cwd(), source });
    if (diff.files.length === 0) {
      if (format === "text") out("no diff available\n"); else out(`${formatMachineEvent({ type: "result", command: "review", status: "empty", findings: [] })}\n`);
      return 0;
    }
    const config = (io.resolve ?? ((flags) => resolveForReview(flags)))({});
    if (config.needsSetup || !config.provider || !config.model || !config.credentials) {
      err("provider setup is required; run lucky interactively before using lucky review\n"); return 3;
    }
    let response = "";
    for await (const event of (io.build ?? ((resolved) => buildAgent({ provider: resolved.provider!, model: resolved.model!, credentials: resolved.credentials!, system: resolved.system, permissions: resolved.permissions, approveTool: () => "deny" })))(config).send(buildReviewPrompt(diff))) {
      if (event.type === "text") response += event.delta;
    }
    const report = parseReviewResponse(response, diff);
    if (format === "text") out(`${report.summary || "no findings"}\n`);
    else if (format === "json") out(`${formatMachineEvent({ type: "result", command: "review", status: report.valid ? "passed" : "failed", report })}\n`);
    else out(`${formatMachineEvent({ type: "result", command: "review", status: report.valid ? "passed" : "failed", findings: report.findings })}\n`);
    return report.valid ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (format === "text") err(`${message}\n`); else out(`${formatMachineEvent({ type: "error", command: "review", message })}\n`);
    return 1;
  }
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function resolveForReview(flags: { provider?: string; model?: string }): ResolvedConfig {
  return resolveConfig(flags);
}

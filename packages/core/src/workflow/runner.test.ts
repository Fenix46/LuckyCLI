import { describe, expect, it } from "vitest";
import {
  runVerificationCommand,
  type VerificationCommand,
  type VerificationEvent,
} from "./verify.js";

function command(script: string): VerificationCommand {
  return {
    id: "test-check",
    label: "test",
    argv: [process.execPath, "-e", script],
    cwd: process.cwd(),
    source: "convention",
  };
}

describe("verification runner", () => {
  it("captures output and emits ordered lifecycle events", async () => {
    const events: VerificationEvent[] = [];
    const result = await runVerificationCommand(
      command("process.stdout.write('ok'); process.stderr.write('warn');"),
      { onEvent: (event) => events.push(event) },
    );

    expect(result).toMatchObject({ status: "passed", exitCode: 0, termination: "exit", output: "okwarn" });
    expect(events.map((event) => event.type)).toEqual(["start", "output", "output", "finish"]);
  });

  it("returns a failed result for a non-zero exit", async () => {
    const result = await runVerificationCommand(command("process.exit(3)"));

    expect(result).toMatchObject({ status: "failed", exitCode: 3, termination: "exit" });
  });

  it("truncates output at the configured limit", async () => {
    const result = await runVerificationCommand(command("process.stdout.write('1234567890')"), {
      maxOutputChars: 5,
    });

    expect(result.output).toBe("12345\n\n[truncated at 5 characters]");
  });

  it("cancels a running process and terminates it", async () => {
    const controller = new AbortController();
    const promise = runVerificationCommand(
      command("setTimeout(() => process.stdout.write('late'), 10000)"),
      { signal: controller.signal },
    );
    controller.abort();
    const result = await promise;

    expect(result).toMatchObject({ status: "cancelled", termination: "cancelled", exitCode: null });
  });

  it("times out a process", async () => {
    const result = await runVerificationCommand(
      command("setTimeout(() => process.stdout.write('late'), 10000)"),
      { timeoutMs: 10 },
    );

    expect(result).toMatchObject({ status: "failed", termination: "timeout", exitCode: null });
  });

  it("honors an already-aborted signal without spawning", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runVerificationCommand(command("throw new Error('must not run')"), {
      signal: controller.signal,
    });

    expect(result.status).toBe("cancelled");
    expect(result.termination).toBe("cancelled");
  });
});

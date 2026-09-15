export const CLI_OUTPUT_VERSION = 1;
export type OutputFormat = "text" | "json" | "jsonl";

export interface MachineOutputEvent {
  version: typeof CLI_OUTPUT_VERSION;
  type: "text" | "status" | "error" | "result";
  [key: string]: unknown;
}

export function parseOutputFormat(value: string | undefined): OutputFormat {
  if (!value) return "text";
  if (value === "text" || value === "json" || value === "jsonl") return value;
  throw new Error(`unknown output format "${value}" (expected text, json, or jsonl)`);
}

export function formatMachineEvent(event: Omit<MachineOutputEvent, "version">): string {
  return JSON.stringify({ version: CLI_OUTPUT_VERSION, ...event });
}

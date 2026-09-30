import { describe, it, expect } from "vitest";
import {
  commandPreviewLines,
  formatCompactNumber,
  formatDuration,
  formatElapsed,
  formatToolResultSummary,
  formatTurnSummary,
  liveTailLines,
  formatToolAction,
  truncateMiddle,
  plural,
  toolResultPreviewLines,
} from "./format.js";

describe("formatElapsed", () => {
  it("stays in plain seconds under a minute", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(1)).toBe("1s");
    expect(formatElapsed(42)).toBe("42s");
    expect(formatElapsed(59)).toBe("59s");
  });

  it("rolls over to minutes at 60s with zero-padded seconds", () => {
    expect(formatElapsed(60)).toBe("1m 00s");
    expect(formatElapsed(61)).toBe("1m 01s");
    expect(formatElapsed(125)).toBe("2m 05s");
    expect(formatElapsed(3599)).toBe("59m 59s");
  });

  it("rolls over to hours with zero-padded minutes and seconds", () => {
    expect(formatElapsed(3600)).toBe("1h 00m 00s");
    expect(formatElapsed(3661)).toBe("1h 01m 01s");
    expect(formatElapsed(7325)).toBe("2h 02m 05s");
  });

  it("floors fractional seconds and clamps negatives", () => {
    expect(formatElapsed(42.9)).toBe("42s");
    expect(formatElapsed(-5)).toBe("0s");
  });
});

describe("formatDuration", () => {
  it("uses ms under a second, one decimal under ten, elapsed format beyond", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(850)).toBe("850ms");
    expect(formatDuration(1400)).toBe("1.4s");
    expect(formatDuration(42_000)).toBe("42s");
    expect(formatDuration(125_000)).toBe("2m 05s");
  });
});

describe("formatCompactNumber", () => {
  it("abbreviates thousands and millions", () => {
    expect(formatCompactNumber(420)).toBe("420");
    expect(formatCompactNumber(8123)).toBe("8.1k");
    expect(formatCompactNumber(45_600)).toBe("46k");
    expect(formatCompactNumber(2_300_000)).toBe("2.3M");
  });
});

describe("formatTurnSummary", () => {
  it("reports time, tools with failures, and tokens", () => {
    expect(
      formatTurnSummary({ elapsedMs: 12_000, tools: 4, failedTools: 1, inputTokens: 8123, outputTokens: 420 }),
    ).toBe("✓ done in 12s · 4 tools (1 failed) · ↑8.1k ↓420 tokens");
  });

  it("omits empty sections", () => {
    expect(formatTurnSummary({ elapsedMs: 900, tools: 1, failedTools: 0, inputTokens: 0, outputTokens: 0 })).toBe(
      "✓ done in 900ms · 1 tool",
    );
  });
});

describe("command output preview", () => {
  it("shows the tail of the output after the summary line", () => {
    const output = ["> build", "step 1", "step 2", "step 3", "step 4", "step 5", "done"].join("\n");
    expect(formatToolResultSummary("exec", output)).toBe("> build");
    expect(toolResultPreviewLines("exec", output)).toEqual(["… 2 more lines", "step 3", "step 4", "step 5", "done"]);
  });

  it("keeps short output whole and skips the failure prefix", () => {
    const output = "[command failed: exit=1]\nError: boom\n  at main.ts:3";
    expect(formatToolResultSummary("exec", output, true)).toBe("Error: boom");
    expect(commandPreviewLines(output)).toEqual(["  at main.ts:3"]);
  });

  it("adds nothing for single-line output", () => {
    expect(toolResultPreviewLines("exec", "(no output)")).toEqual([]);
  });
});

describe("truncateMiddle", () => {
  it("keeps short values and elides the middle of long ones", () => {
    expect(truncateMiddle("~/code/app", 20)).toBe("~/code/app");
    const out = truncateMiddle("/tmp/very/long/path/to/the/project/folder", 20);
    expect(out).toHaveLength(20);
    expect(out.startsWith("/tmp/")).toBe(true);
    expect(out.endsWith("folder")).toBe(true);
    expect(out).toContain("…");
  });
});

describe("plural", () => {
  it("picks the singular for one", () => {
    expect(plural(1, "line")).toBe("1 line");
    expect(plural(3, "line")).toBe("3 lines");
    expect(plural(1, "entry", "entries")).toBe("1 entry");
    expect(formatToolResultSummary("list_dir", "only.txt")).toBe("1 entry");
  });
});

describe("background process rows", () => {
  it("label background commands and process actions", () => {
    expect(formatToolAction("exec", { command: "npm run dev", background: true }, true)).toBe(
      "Run npm run dev (background)",
    );
    expect(formatToolAction("process", { action: "output", id: "bg1" }, false)).toBe("Checked process output bg1");
    expect(formatToolAction("process", { action: "list" }, false)).toBe("Checked process list");
  });
});

describe("liveTailLines", () => {
  it("keeps the last lines, strips colors and collapses progress bars", () => {
    const live = "one\n\u001b[32mtwo\u001b[39m\n10%\r50%\r100%\nfour\n\n";
    expect(liveTailLines(live)).toEqual(["two", "100%", "four"]);
    expect(liveTailLines("a\nb\nc\nd", 2)).toEqual(["c", "d"]);
  });
});

describe("plan rows", () => {
  it("name the plan instead of dumping its JSON", () => {
    expect(formatToolAction("present_plan", { title: "Add a lint step", plan: "…", tasks: [] }, false)).toBe(
      "Presented plan Add a lint step",
    );
  });
});

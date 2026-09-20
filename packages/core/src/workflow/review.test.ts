import { describe, expect, it } from "vitest";
import { buildReviewPrompt, parseReviewResponse } from "./review.js";
import type { ReviewDiffResult } from "./review-diff.js";

const diff: ReviewDiffResult = {
  cwd: "/repo",
  source: "staged",
  truncated: false,
  totalChars: 30,
  files: [{ path: "src/app.ts", status: "modified", source: "staged", patch: "@@ -1 +1 @@\n-const ok = true;\n+const ok = false;", binary: false, truncated: false, additions: 1, deletions: 1 }],
};

describe("structured diff review", () => {
  it("builds a prompt that carries source and exact diff paths", () => {
    const prompt = buildReviewPrompt(diff);
    expect(prompt).toContain("Diff source: staged");
    expect(prompt).toContain("src/app.ts");
    expect(prompt).toContain("Return JSON only");
  });

  it("validates, marks invented paths, and deduplicates findings", () => {
    const response = JSON.stringify({
      summary: "One issue",
      findings: [
        { severity: "high", category: "bug", path: "src/app.ts", line: 1, title: "Wrong default", explanation: "The value is disabled." },
        { severity: "high", category: "bug", path: "src/app.ts", line: 1, title: "wrong DEFAULT", explanation: "Duplicate." },
        { severity: "low", category: "style", path: "secret.ts", title: "Other", explanation: "Not in diff." },
        { severity: "medium", category: "test-gap", path: "src/app.ts", line: 99, title: "Missing test", explanation: "Line is not changed." },
      ],
    });
    const report = parseReviewResponse(response, diff);
    expect(report.valid).toBe(true);
    expect(report.findings).toHaveLength(3);
    expect(report.findings[1]?.outOfDiff).toBe(true);
    expect(report.findings[2]?.outOfDiff).toBe(true);
  });

  it("degrades malformed and incomplete responses without throwing", () => {
    expect(parseReviewResponse("not json", diff)).toMatchObject({ valid: false, findings: [] });
    expect(parseReviewResponse({ summary: "No findings", findings: [] }, diff)).toMatchObject({ valid: true, findings: [] });
    expect(parseReviewResponse({ findings: [{ severity: "urgent" }] }, diff)).toMatchObject({ valid: false, findings: [] });
  });
});

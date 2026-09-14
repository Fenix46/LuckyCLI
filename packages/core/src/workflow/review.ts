import { z } from "zod";
import type { ReviewDiffResult } from "./review-diff.js";

export const REVIEW_SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export const REVIEW_CATEGORIES = ["bug", "security", "breaking-change", "test-gap", "style"] as const;

export const ReviewFindingSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(REVIEW_SEVERITIES),
  category: z.enum(REVIEW_CATEGORIES),
  path: z.string().min(1),
  line: z.number().int().positive().optional(),
  title: z.string().min(1),
  explanation: z.string().min(1),
  suggestion: z.string().min(1).optional(),
  outOfDiff: z.boolean().default(false),
});

export const ReviewReportSchema = z.object({
  source: z.string().min(1),
  summary: z.string(),
  findings: z.array(ReviewFindingSchema),
  rawText: z.string().optional(),
  valid: z.boolean(),
});

export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;
export type ReviewReport = z.infer<typeof ReviewReportSchema>;

/** Build a compact, provider-neutral instruction for a technical diff review. */
export function buildReviewPrompt(diff: ReviewDiffResult): string {
  const files = diff.files.map((file) => ({
    path: file.path,
    status: file.status,
    source: file.source,
    binary: file.binary,
    truncated: file.truncated,
    patch: file.patch,
    summary: file.summary,
  }));
  return [
    "Review only the supplied diff. Do not infer or report changes outside these files.",
    "Find correctness, security, compatibility, missing-test, and style issues.",
    "Return JSON only in this shape: {\"summary\":string,\"findings\":[{\"severity\":\"critical|high|medium|low|info\",\"category\":\"bug|security|breaking-change|test-gap|style\",\"path\":string,\"line\":number,\"title\":string,\"explanation\":string,\"suggestion\":string}]}.",
    "Use a changed line when possible. Never invent a path; use the exact path from the diff.",
    `Diff source: ${diff.source}`,
    JSON.stringify({ files }),
  ].join("\n\n");
}

/** Validate and normalize a model response, degrading malformed JSON safely. */
export function parseReviewResponse(value: unknown, diff: ReviewDiffResult): ReviewReport {
  const parsed = ReviewReportInputSchema.safeParse(parseJson(value));
  if (!parsed.success) {
    return { source: diff.source, summary: "The reviewer returned an unreadable response.", findings: [], rawText: textValue(value), valid: false };
  }
  const allowed = new Map(diff.files.map((file) => [file.path, changedLines(file.patch)]));
  const findings = deduplicate(parsed.data.findings.map((finding, index) => ({
    id: finding.id ?? `finding-${index + 1}`,
    severity: finding.severity,
    category: finding.category,
    path: finding.path,
    ...(finding.line === undefined ? {} : { line: finding.line }),
    title: finding.title,
    explanation: finding.explanation,
    ...(finding.suggestion ? { suggestion: finding.suggestion } : {}),
    outOfDiff: !allowed.has(finding.path) || (finding.line !== undefined && !allowed.get(finding.path)?.has(finding.line)),
  })));
  return { source: diff.source, summary: parsed.data.summary, findings, valid: true };
}

const ReviewFindingInputSchema = z.object({
  id: z.string().min(1).optional(),
  severity: z.enum(REVIEW_SEVERITIES),
  category: z.enum(REVIEW_CATEGORIES),
  path: z.string().min(1),
  line: z.number().int().positive().optional(),
  title: z.string().min(1),
  explanation: z.string().min(1),
  suggestion: z.string().min(1).optional(),
});

const ReviewReportInputSchema = z.object({
  summary: z.string().default(""),
  findings: z.array(ReviewFindingInputSchema).default([]),
});

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value) as unknown; } catch { return undefined; }
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function deduplicate(findings: ReviewFinding[]): ReviewFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = [finding.category, finding.path, finding.line ?? "", finding.title.toLowerCase()].join("\0");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function changedLines(patch: string | undefined): Set<number> {
  const lines = new Set<number>();
  if (!patch) return lines;
  let newLine = 0;
  for (const line of patch.split("\n")) {
    const header = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (header) {
      newLine = Number(header[1]);
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) lines.add(newLine++);
    else if (!line.startsWith("-")) newLine++;
  }
  return lines;
}

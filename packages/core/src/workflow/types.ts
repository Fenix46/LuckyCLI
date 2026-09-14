import { z } from "zod";

/** Lifecycle states shared by verification checks and workflow records. */
export const WORKFLOW_STATUSES = [
  "pending",
  "running",
  "passed",
  "failed",
  "cancelled",
] as const;

export const WorkflowStatusSchema = z.enum(WORKFLOW_STATUSES);
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;

const NonEmptyString = z.string().min(1);

/** A file involved in a checkpoint, with its state before the checkpoint. */
export const CheckpointFileSchema = z.object({
  path: NonEmptyString,
  existed: z.boolean(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().nonnegative(),
  contentPath: NonEmptyString.optional(),
});

export type CheckpointFile = z.infer<typeof CheckpointFileSchema>;

/** Durable metadata identifying a pre-edit filesystem state. */
export const CheckpointSchema = z.object({
  id: NonEmptyString,
  sessionId: NonEmptyString,
  cwd: NonEmptyString,
  title: NonEmptyString,
  reason: NonEmptyString.optional(),
  createdAt: z.number().int().nonnegative(),
  status: WorkflowStatusSchema,
  files: z.array(CheckpointFileSchema),
});

export type Checkpoint = z.infer<typeof CheckpointSchema>;

/** One project command executed by a verification run. */
export const VerificationCheckSchema = z.object({
  id: NonEmptyString,
  command: NonEmptyString,
  cwd: NonEmptyString,
  status: WorkflowStatusSchema,
  startedAt: z.number().int().nonnegative().optional(),
  finishedAt: z.number().int().nonnegative().optional(),
  exitCode: z.number().int().nullable().optional(),
  output: z.string(),
});

export type VerificationCheck = z.infer<typeof VerificationCheckSchema>;

/** Structured result returned by a verification run. */
export const VerificationResultSchema = z.object({
  id: NonEmptyString,
  sessionId: NonEmptyString,
  cwd: NonEmptyString,
  status: WorkflowStatusSchema,
  startedAt: z.number().int().nonnegative(),
  finishedAt: z.number().int().nonnegative().optional(),
  checks: z.array(VerificationCheckSchema),
  files: z.array(NonEmptyString),
});

export type VerificationResult = z.infer<typeof VerificationResultSchema>;

/** Parse persisted workflow data and throw a useful validation error. */
export function parseCheckpoint(value: unknown): Checkpoint {
  return CheckpointSchema.parse(value);
}

export function parseVerificationResult(value: unknown): VerificationResult {
  return VerificationResultSchema.parse(value);
}

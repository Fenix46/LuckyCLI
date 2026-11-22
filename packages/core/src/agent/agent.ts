import { randomUUID } from "node:crypto";
import type { IProvider } from "../providers/IProvider.js";
import type {
  ContentPart,
  FinishReason,
  ModelInfo,
  Message,
  ReasoningPart,
  ProviderStatus,
  TextPart,
  ToolCallPart,
  TokenUsage,
} from "../providers/types.js";
import { modelInfo } from "../providers/catalog.js";
import {
  resolveToolPermission,
  type ToolPermission,
  type ToolPermissionPolicy,
} from "../tools/permissions.js";
import type { ToolRegistry } from "../tools/registry.js";
import type {
  AskUserRequest,
  SpawnAgentRequest,
  SpawnAgentResult,
  ToolResult,
} from "../tools/types.js";
import type { PlanDecision, PlanProposal } from "./plan.js";
import { buildSummarizationPrompt } from "../prompts/index.js";
import {
  resolveVerificationCommands,
  runVerification,
  runVerificationCommand,
} from "../workflow/verify.js";
import type { VerificationResult } from "../workflow/types.js";
import type { AgentEvent, CompactionResult, ContextStatus } from "./types.js";
import { ReadLedger } from "../tools/read-ledger.js";
import { FileStateLedger } from "../tools/file-state.js";
import { classifyCommandSemantics } from "../tools/builtin/exec.js";
import { classifyPowerShellCommandSemantics } from "../tools/builtin/powershell.js";
import { ownershipOverlaps } from "../agents/ownership.js";

const INTERRUPTED_MARKER = "[Request interrupted by user]";
const PLAN_MODE_PROMPT = `# Plan mode
Plan mode is on. Do not edit files, run mutating commands, or change the workspace. Explore with read-only tools and read-only shell commands, resolve open questions with ask_user, then call present_plan. When the user accepts the plan, plan mode ends and you can implement its tasks. If they ask for changes, revise the plan and present it again.`;
// Compaction summaries are a mechanical, low-stakes task: run them on the
// cheapest model the provider exposes rather than the (possibly Opus-class)
// model driving the conversation. Falls back to the main model if the provider
// has no cheaper option.
const SUMMARIZATION_MODEL_BY_PROVIDER: Record<string, string> = {
  claude: "claude-haiku-4-5-20251001",
  "openai-oauth": "gpt-6-luna",
  antigravity: "gemini-3.8-flash-low",
};

export interface AgentConfig {
  provider: IProvider;
  model: string;
  tools: ToolRegistry;
  system?: string;
  cwd?: string;
  temperature?: number;
  maxTokens?: number;
  /** Reasoning effort for providers that support it. Forwarded as-is. */
  reasoningEffort?: string;
  /** Optional provider-specific thinking toggle (currently Claude). */
  thinkingEnabled?: boolean;
  /**
   * Start in plan mode: read-only exploration only. Mutating tools are denied
   * until the host calls setPlanMode(false), which the TUI/ACP do when the user
   * accepts a plan. Read-only tools and read-only shell commands stay available.
   */
  planMode?: boolean;
  /**
   * Optional safety bound on provider round-trips per user turn. Unset means
   * unlimited: the agent keeps working until the model stops requesting tools
   * or the user interrupts (Esc). This is intentionally *not* capped by default
   * so a productive loop is never killed mid-task.
   */
  maxSteps?: number;
  compaction?: {
    enabled?: boolean;
    thresholdRatio?: number;
    keepRecentTurns?: number;
    reservedOutputTokens?: number;
    /**
     * Absolute ceiling on the context the agent lets build up before it
     * compacts, regardless of how large the model's window is. Every step
     * re-sends the whole transcript, so a 1M-token window filled to 75% would
     * re-bill ~750k input tokens per tool call. Also the trigger used when
     * the window is unknown (e.g. a local model without a configured size).
     * Set to 0 to rely on thresholdRatio alone.
     */
    maxContextTokens?: number;
  };
  /** Tool permission policy. Supports exact tool names and wildcard patterns. */
  permissions?: ToolPermissionPolicy;
  /** Optional callback to approve tools whose resolved permission is ask. */
  approveTool?: (name: string, input: unknown) => Promise<ToolApproval> | ToolApproval;
  /** Optional bridge used by the ask_user tool to query the human. */
  askUser?: (request: AskUserRequest) => Promise<string>;
  /** Optional bridge used by the present_plan tool to get the user's decision. */
  presentPlan?: (plan: PlanProposal) => Promise<PlanDecision>;
  /** Optional bridge used by the spawn_agent tool to run a sub-agent. */
  runSubAgent?: (
    request: SpawnAgentRequest,
    signal?: AbortSignal,
  ) => Promise<SpawnAgentResult>;
  /** Optional hook fired after a tool reports changed files (for graph upkeep). */
  onFilesChanged?: (paths: string[]) => void;
  /** Optional hook fired when a tool may have changed unknown files (shell commands). */
  onWorkspaceChanged?: () => void;
  /**
   * When to run the project's checks automatically:
   * - "manual" (default): only when asked;
   * - "after-edit": every trusted check after each successful file edit;
   * - "end-of-turn": one quick check (typecheck, else build, else test) when
   *   the model is about to finish a turn in which it edited files; a failure
   *   is handed back to the model to fix (at most twice per turn).
   */
  verificationMode?: VerificationMode;
  /** Session id included in automatic verification results. */
  verificationSessionId?: string;
  /** Optional hook fired when the model loads a skill via skill_load. */
  onSkillLoaded?: (id: string) => void;
  /** Optional project skill allowlist forwarded to skill tools. */
  allowedSkills?: readonly string[];
  /**
   * Optional host-backed file access forwarded to the file tools: lets a host
   * (e.g. an ACP editor) serve reads from unsaved buffers and receive writes.
   * See ToolContext.readTextFile / writeTextFile.
   */
  readTextFile?: (absPath: string) => Promise<string | null>;
  writeTextFile?: (absPath: string, content: string) => Promise<void>;
  /**
   * Optional per-turn context enrichment (e.g. the graph enricher): receives
   * the user turn's text and may return an extra block appended to that turn
   * as an additional text part. Best-effort — a thrown error or null leaves
   * the turn untouched. Appending to the user turn (never the system prompt)
   * keeps the prompt-cache prefix stable.
   */
  enrichTurn?: (userText: string) => Promise<string | null> | string | null;
  /** Prior conversation to resume from. Copied into the history on construction. */
  messages?: Message[];
  /** Cumulative usage restored from a persisted session. */
  initialUsage?: TokenUsage;
  /** Retry count restored from a persisted session. */
  initialRetryCount?: number;
  /**
   * Conversation identity for provider prompt-cache routing. Pass the stored
   * key when resuming so requests land on the same warm cache; a fresh one is
   * generated otherwise.
   */
  promptCacheKey?: string;
  /**
   * The restored history is being resumed with a cold provider cache: if it
   * is large, compact it once before the first turn, so the old part is
   * summarized by a cheap model once instead of being re-sent at full price
   * on every step. The summary is part of the history from then on, so the
   * next resume starts light too.
   */
  compactOnResume?: boolean;
}

export type ToolApproval = "allow" | "always" | "deny" | boolean;

interface RequiredCompactionConfig {
  enabled: boolean;
  thresholdRatio: number;
  keepRecentTurns: number;
  maxContextTokens: number;
  reservedOutputTokens?: number;
}

/**
 * The agent loop. Owns the conversation history and drives the
 * provider <-> tool cycle:
 *   1. stream the running transcript to the provider
 *   2. assemble the assistant message (text + tool calls)
 *   3. if tools were requested, execute them and append the results
 *   4. repeat until the model stops without requesting a tool
 *
 * Fully provider-agnostic — everything flows through canonical types.
 */
export class Agent {
  private readonly provider: IProvider;
  private readonly model: string;
  private readonly tools: ToolRegistry;
  private readonly system: string | undefined;
  private readonly cwd: string;
  private readonly temperature: number | undefined;
  private readonly maxTokens: number | undefined;
  private readonly reasoningEffort: string | undefined;
  private readonly thinkingEnabled: boolean | undefined;
  private planMode: boolean;
  private readonly maxSteps: number | undefined;
  private readonly compaction: RequiredCompactionConfig;
  private readonly modelInfo: ModelInfo;
  private readonly permissions: ToolPermissionPolicy | undefined;
  private readonly approveTool: ((name: string, input: unknown) => Promise<ToolApproval> | ToolApproval) | undefined;
  private readonly askUser: ((request: AskUserRequest) => Promise<string>) | undefined;
  private readonly presentPlan: ((plan: PlanProposal) => Promise<PlanDecision>) | undefined;
  private readonly runSubAgent: ((request: SpawnAgentRequest, signal?: AbortSignal) => Promise<SpawnAgentResult>) | undefined;
  private readonly onFilesChanged: ((paths: string[]) => void) | undefined;
  private readonly onWorkspaceChanged: (() => void) | undefined;
  private verificationMode: VerificationMode;
  private readonly verificationSessionId: string | undefined;
  private readonly onSkillLoaded: ((id: string) => void) | undefined;
  private readonly allowedSkills: readonly string[] | undefined;
  private readonly readTextFile: ((absPath: string) => Promise<string | null>) | undefined;
  private readonly writeTextFile: ((absPath: string, content: string) => Promise<void>) | undefined;
  private readonly enrichTurn: ((userText: string) => Promise<string | null> | string | null) | undefined;
  private lastUsage: TokenUsage | undefined;
  /** Memoized provider token count, keyed by a fingerprint of the transcript. */
  private countCache: { fingerprint: string; usage: TokenUsage } | undefined;
  /** Consecutive failures per tool-call signature, reset on success. */
  private readonly repeatedToolFailures = new Map<string, number>();
  private totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  private retryCount = 0;
  /**
   * The last request size the provider measured, and the size (in chars) of
   * the transcript that request carried. The current context is that measure
   * plus the estimated size of whatever changed since: tool results and
   * replies appended after it, minus anything pruned or compacted away. A
   * bare "last usage" ignores both and goes stale the moment the transcript
   * changes.
   */
  private usageAnchor: { usedTokens: number; historyChars: number } | undefined;
  /** Chars per token for this conversation, calibrated from measured usage. */
  private charsPerToken = CHARS_PER_TOKEN;
  /** Context window reported by a provider overflow error; overrides the catalog. */
  private learnedContextWindow: number | undefined;
  /** Stable per-conversation key so providers can route requests to a warm prompt cache. */
  private readonly promptCacheKey: string;
  /** Set until the first turn decides whether a large resumed history gets compacted. */
  private compactOnResume: boolean;
  /** File reads whose results are still in the transcript (see ReadLedger). */
  private readonly readLedger = new ReadLedger();
  /** Content the model has read per path, for the read-before-edit gate. */
  private readonly fileState = new FileStateLedger();
  private readonly history: Message[] = [];

  constructor(cfg: AgentConfig) {
    this.provider = cfg.provider;
    this.model = cfg.model;
    this.tools = cfg.tools;
    this.system = cfg.system;
    this.cwd = cfg.cwd ?? process.cwd();
    this.temperature = cfg.temperature;
    this.maxTokens = cfg.maxTokens;
    this.reasoningEffort = cfg.reasoningEffort;
    this.thinkingEnabled = cfg.thinkingEnabled;
    this.planMode = cfg.planMode === true;
    this.maxSteps = cfg.maxSteps;
    this.compaction = {
      enabled: cfg.compaction?.enabled ?? true,
      thresholdRatio: cfg.compaction?.thresholdRatio ?? 0.75,
      keepRecentTurns: cfg.compaction?.keepRecentTurns ?? 6,
      maxContextTokens: cfg.compaction?.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS,
      ...(cfg.compaction?.reservedOutputTokens !== undefined
        ? { reservedOutputTokens: cfg.compaction.reservedOutputTokens }
        : {}),
    };
    this.modelInfo = cfg.provider.info.models?.[cfg.model] ?? modelInfo(cfg.provider.info.id, cfg.model);
    this.permissions = cfg.permissions;
    this.approveTool = cfg.approveTool;
    this.askUser = cfg.askUser;
    this.presentPlan = cfg.presentPlan;
    this.runSubAgent = cfg.runSubAgent;
    this.onFilesChanged = cfg.onFilesChanged;
    this.onWorkspaceChanged = cfg.onWorkspaceChanged;
    this.verificationMode = cfg.verificationMode ?? "manual";
    this.verificationSessionId = cfg.verificationSessionId;
    this.onSkillLoaded = cfg.onSkillLoaded;
    this.allowedSkills = cfg.allowedSkills;
    this.totalUsage = { ...this.totalUsage, ...(cfg.initialUsage ?? {}) };
    this.retryCount = cfg.initialRetryCount ?? 0;
    this.readTextFile = cfg.readTextFile;
    this.writeTextFile = cfg.writeTextFile;
    this.enrichTurn = cfg.enrichTurn;
    this.promptCacheKey = cfg.promptCacheKey ?? randomUUID();
    this.compactOnResume = cfg.compactOnResume === true && (cfg.messages?.length ?? 0) > 0;
    if (cfg.messages?.length) this.history.push(...cfg.messages);
  }

  /** The conversation so far. Useful for persistence or inspection. */
  get messages(): readonly Message[] {
    return this.history;
  }

  /** The system prompt sent with every request (persisted to resume with a warm cache). */
  get systemPrompt(): string | undefined {
    return this.system;
  }

  /** True while mutating tools are denied and only read-only work is allowed. */
  get planModeEnabled(): boolean {
    return this.planMode;
  }

  /**
   * Enter or leave plan mode. The host calls this when the user toggles the
   * mode (Shift+Tab) or accepts a presented plan. It deliberately does not
   * touch the transcript: the next request carries the updated system prompt.
   */
  setPlanMode(enabled: boolean): void {
    this.planMode = enabled;
  }

  /** The conversation's prompt-cache key (persisted alongside the session). */
  get cacheKey(): string {
    return this.promptCacheKey;
  }

  /** Cumulative token usage across every turn this agent has run. */
  get totalTokenUsage(): TokenUsage {
    return { ...this.totalUsage };
  }

  get totalRetryCount(): number {
    return this.retryCount;
  }

  private currentModelInfo(): ModelInfo {
    const info = this.catalogModelInfo();
    const learned = this.learnedContextWindow;
    if (learned === undefined || (info.contextWindow !== undefined && info.contextWindow <= learned)) return info;
    // The server told us its real limit in an overflow error: trust it over
    // the catalog or a manually configured window.
    const { maxInputTokens, ...rest } = info;
    return {
      ...rest,
      contextWindow: learned,
      ...(maxInputTokens !== undefined && maxInputTokens < learned ? { maxInputTokens } : {}),
    };
  }

  private catalogModelInfo(): ModelInfo {
    const known = this.provider.info.models?.[this.model] ?? this.modelInfo;
    // For local providers the chosen model id is arbitrary and absent from the
    // catalog, so apply the provider-wide manual context window when the
    // resolved model info has none of its own.
    if (known.contextWindow === undefined && this.provider.info.defaultContextWindow) {
      return { ...known, contextWindow: this.provider.info.defaultContextWindow };
    }
    return known;
  }

  async contextStatus(): Promise<ContextStatus> {
    return this.contextStatusFor(this.history);
  }

  /**
   * Context status for the routine compaction checks, without a billed
   * round-trip. Builds on the last stream's usage (an authoritative measure of
   * the transcript we sent) plus an estimate of what changed since; only
   * falls back to a real count before any usage has been observed.
   */
  private async cheapContextStatus(historyChars?: number): Promise<ContextStatus> {
    if (this.usageAnchor) return this.estimatedStatus(historyChars);
    return this.contextStatus();
  }

  /**
   * Context status without asking the provider: the anchored measure plus the
   * estimated change since it, or a pure estimate of the whole request when
   * nothing has been measured yet (e.g. a server that never reports usage).
   */
  private estimatedStatus(historyChars = transcriptChars(this.history)): ContextStatus {
    const anchor = this.usageAnchor;
    if (anchor) {
      if (historyChars === anchor.historyChars) return this.statusFor(anchor.usedTokens, "provider");
      const delta = (historyChars - anchor.historyChars) / this.charsPerToken;
      return this.statusFor(Math.max(0, Math.round(anchor.usedTokens + delta)), "estimate");
    }
    return this.statusFor(Math.round((historyChars + this.overheadChars()) / this.charsPerToken), "estimate");
  }

  /** Size of what every request carries besides the transcript: system prompt and tool schemas. */
  private overheadChars(): number {
    return (this.effectiveSystemPrompt()?.length ?? 0) + this.tools.definitionsJsonLength();
  }

  async providerStatus(): Promise<ProviderStatus> {
    if (this.provider.getStatus) return this.provider.getStatus();
    return {
      provider: this.provider.info.id,
      displayName: this.provider.info.displayName,
      authType: "unknown",
      notes: ["Provider does not expose account or quota status."],
    };
  }

  /**
   * Compact on explicit user request (`/compact`). Compresses whenever there is
   * anything to compress, even on a short conversation that hasn't yet grown
   * past keepRecentTurns; the automatic path stays threshold-gated.
   *
   * The returned `status` is the post-compaction context, already measured
   * here — callers should display it rather than calling `contextStatus()`
   * again, which on Claude OAuth costs another billed round-trip.
   */
  async compactNow(): Promise<CompactionResult & { status: ContextStatus }> {
    return this.compactHistory(undefined, { force: true });
  }

  /** Change when checks run automatically (e.g. when the session enters auto mode). */
  setVerificationMode(mode: VerificationMode): void {
    this.verificationMode = mode;
  }

  /** Run one user turn to completion, yielding events as work progresses. */
  async *send(
    userInput: string | ContentPart[],
    signal?: AbortSignal,
  ): AsyncIterable<AgentEvent> {
    // A plain string is the common case (text turn); an explicit ContentPart[]
    // lets callers mix text with images and other parts for multimodal turns.
    // Copied so enrichment below never mutates a caller-owned array.
    const content: ContentPart[] =
      typeof userInput === "string" ? [{ type: "text", text: userInput }] : [...userInput];
    if (this.enrichTurn) {
      const userText = content
        .filter((part): part is TextPart => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      if (userText.trim()) {
        try {
          const extra = await this.enrichTurn(userText);
          if (extra) content.push({ type: "text", text: extra });
        } catch {
          // Enrichment is best-effort; a broken graph must never break a turn.
        }
      }
    }
    this.history.push({ role: "user", content });
    // Failure tracking is per turn: a new user message resets the counters so
    // a tool that legitimately recovered isn't throttled by an old failure.
    this.repeatedToolFailures.clear();
    // Files edited this turn, and how many end-of-turn checks already ran.
    const editedThisTurn = new Set<string>();
    let autoChecks = 0;

    // Use the cheap, already-known context size for the routine pre-turn check.
    // The previous stream's final usage measured the full transcript we sent, so
    // it is an authoritative count — and reusing it avoids a real billed probe
    // (Claude OAuth has no free /count_tokens; it would re-send the whole
    // transcript) on every single turn. A real count only happens on demand
    // (/context, /status) or as a fallback when there is no prior usage yet.
    const beforeStatus = await this.cheapContextStatus();
    yield { type: "context", status: beforeStatus };
    // Context size right after the last compaction this turn, if any. A long
    // tool loop may need several compactions in one turn, but only once the
    // context has grown meaningfully again — never one per step.
    let compactedAt: number | undefined;
    const resumeCompaction =
      this.compactOnResume && transcriptChars(this.history) / this.charsPerToken >= RESUME_COMPACT_MIN_TOKENS;
    this.compactOnResume = false;
    if (resumeCompaction || this.shouldCompact(beforeStatus)) {
      // compactHistory already measured the post-compaction transcript; reuse
      // that status instead of measuring the same history a second time. On
      // Claude OAuth a status call is a real billed request (no free
      // /count_tokens), so the duplicate was costing an extra full-transcript
      // round-trip on every compaction.
      // A resumed history may be one long turn with no older turns to split
      // off; forcing keeps just the new message verbatim in that case.
      const compacted = await this.tryCompact(beforeStatus.usedTokens, { force: resumeCompaction });
      if (compacted) {
        const { status: afterStatus, ...result } = compacted;
        yield { type: "context_compacted", result };
        yield { type: "context", status: afterStatus };
        compactedAt = afterStatus.usedTokens ?? 0;
      }
    }

    // Unbounded by default: the loop ends when the model stops requesting tools
    // or the user interrupts. A finite maxSteps is only enforced when explicitly
    // configured, as a safety bound against a runaway tool-calling loop.
    for (let step = 0; this.maxSteps === undefined || step < this.maxSteps; step++) {
      // Stop cleanly between steps if the user interrupted while tools ran.
      if (signal?.aborted) {
        this.finalizeInterrupted();
        yield { type: "aborted" };
        return;
      }

      // Re-check context pressure between steps, not just once per turn: a
      // long tool loop can pile on large tool results and overflow the window
      // mid-turn with no recovery. The check is free (reuses the last stream's
      // usage) and compacts only older turns, keeping the current one intact.
      // Long tool loops are the main source of context growth, and a single
      // user turn can't be compacted (the current turn is always kept). So
      // once the transcript gets large, clear the bodies of old tool results:
      // the model keeps the call and a short note, and can re-run the tool.
      // One O(history) count serves both checks; pruning invalidates it, so
      // recompute only when the transcript actually shrank.
      let stepChars = transcriptChars(this.history);
      const pruneStatus = await this.cheapContextStatus(stepChars);
      if (this.shouldPruneToolResults(pruneStatus) && this.pruneOldToolResults() > 0) {
        stepChars = transcriptChars(this.history);
        yield { type: "context", status: await this.cheapContextStatus(stepChars) };
      }

      const midStatus = await this.cheapContextStatus(stepChars);
      if (this.shouldCompact(midStatus) && this.grewSinceCompaction(midStatus, compactedAt)) {
        // Mid-turn, the current turn itself may be the bulk of the context
        // (one request driving a long tool loop), so compaction may also
        // summarize this turn's older steps — see compactHistory.
        const compacted = await this.tryCompact(midStatus.usedTokens, { midTurn: true });
        if (compacted) {
          const { status: afterStatus, ...result } = compacted;
          yield { type: "context_compacted", result };
          yield { type: "context", status: afterStatus };
          compactedAt = afterStatus.usedTokens ?? 0;
        }
      }

      let finishReason: FinishReason = "stop";
      let usage: TokenUsage | undefined;
      const toolCalls: ToolCallPart[] = [];
      const reasoningParts: ReasoningPart[] = [];
      let textBuf = "";
      // Transcript size this request carries, to anchor the usage it reports.
      let sentChars = transcriptChars(this.history);
      let overflowRecovered = false;

      try {
        // Transient provider failures (429/5xx, network resets) are retried
        // with backoff — but only while NOTHING has been streamed yet: replaying
        // a partially consumed stream would hand the caller duplicated text or
        // tool calls. A permanent error or a mid-stream failure ends the turn.
        let attempts = 0;
        while (true) {
          let yieldedThisStep = false;
          let sawAnyChunk = false;
          try {
            for await (const chunk of this.provider.generateStream(
              [...this.history],
              this.generationConfig(signal),
            )) {
              sawAnyChunk = true;
              if (chunk.textDelta) {
                yieldedThisStep = true;
                textBuf += chunk.textDelta;
                yield { type: "text", delta: chunk.textDelta };
              }
              if (chunk.reasoning) yield { type: "reasoning" };
              if (chunk.reasoningPart) reasoningParts.push(chunk.reasoningPart);
              if (chunk.toolCall) {
                yieldedThisStep = true;
                toolCalls.push(chunk.toolCall);
              }
              if (chunk.finishReason) finishReason = chunk.finishReason;
              if (chunk.usage) usage = chunk.usage;
            }
            // A stream that completes without a single chunk is a broken model
            // response, not a decision to stay silent: the caller only learns
            // about it through events, so surface it as an error instead of
            // silently ending the turn with nothing visible.
            if (!sawAnyChunk) {
              throw new Error(
                "Model returned an empty response (no content, no finish reason).",
              );
            }
            break;
          } catch (err) {
            // The request no longer fits the model's window (the window was
            // unknown or larger than the server's real limit, or one step
            // added more than the headroom). Shrink the transcript once and
            // retry, instead of ending the turn on an error every later
            // request would repeat.
            if (!yieldedThisStep && !overflowRecovered && !signal?.aborted && isContextOverflowError(err)) {
              overflowRecovered = true;
              this.learnContextWindow(err);
              const recovered = yield* this.recoverFromOverflow();
              if (!recovered) throw err;
              reasoningParts.length = 0;
              sentChars = transcriptChars(this.history);
              continue;
            }
            if (
              yieldedThisStep ||
              signal?.aborted ||
              attempts >= MAX_TRANSIENT_RETRIES ||
              !isTransientError(err)
            ) {
              throw err;
            }
            attempts += 1;
            this.retryCount += 1;
            const delayMs = TRANSIENT_RETRY_BACKOFF_MS * 2 ** (attempts - 1);
            yield { type: "retry", attempt: attempts, maxAttempts: MAX_TRANSIENT_RETRIES, delayMs };
            await sleep(delayMs);
            if (signal?.aborted) throw err;
          }
        }
      } catch (err) {
        // A user-triggered abort surfaces as a provider error mid-stream. Treat
        // it as a clean interruption: keep whatever was streamed and record the
        // interruption so the next turn resumes from a consistent transcript.
        if (isAbortError(err) || signal?.aborted) {
          this.finalizeInterrupted(textBuf);
          yield { type: "aborted" };
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        yield { type: "error", message };
        return;
      }

      // Assemble the assistant turn: text first, then any tool calls. Never
      // persist an empty turn: a message with no content blocks serializes to a
      // Content with empty parts[], which some providers (Gemini / Code Assist)
      // reject with 400 INVALID_ARGUMENT on the *next* request. If the model
      // produced nothing usable (e.g. only a thought, or an empty candidate),
      // end the turn without poisoning the transcript.
      const assistantBlocks: ContentPart[] = [];
      if (textBuf) assistantBlocks.push({ type: "text", text: textBuf });
      assistantBlocks.push(...toolCalls);
      // Reasoning state rides along with the turn it produced, ahead of it, so
      // the provider can hand it back next step. Alone it is not a turn.
      if (assistantBlocks.length > 0) assistantBlocks.unshift(...reasoningParts);
      if (assistantBlocks.length > 0) {
        this.history.push({ role: "assistant", content: assistantBlocks });
      }

      if (usage) this.recordUsage(usage, sentChars);

      // About to finish after editing files: in end-of-turn mode, check the
      // work first and hand a failure back to the model instead of ending.
      if (
        toolCalls.length === 0 &&
        this.verificationMode === "end-of-turn" &&
        editedThisTurn.size > 0 &&
        assistantBlocks.length > 0 &&
        autoChecks < MAX_AUTO_CHECKS &&
        !signal?.aborted
      ) {
        autoChecks += 1;
        const failure = yield* this.runEndOfTurnCheck(signal);
        if (failure) {
          this.history.push({ role: "user", content: [{ type: "text", text: failure }] });
          continue;
        }
      }

      // No tools requested -> the turn is complete.
      if (toolCalls.length === 0 || finishReason !== "tool_calls") {
        // A turn can end with tool calls left unexecuted — e.g. max_tokens cut
        // the response right after a complete tool_use block, or the provider
        // reported an unexpected stop reason. Those blocks are already in the
        // assistant message above; leaving them unanswered poisons the
        // transcript (Anthropic and OpenAI both reject the next request when a
        // tool call has no matching result, and the session persists as-is).
        // Close them with synthetic error results so the history stays valid.
        if (toolCalls.length > 0) {
          this.history.push({
            role: "tool",
            content: toolCalls.map((call) => ({
              type: "tool_result",
              toolCallId: call.id,
              name: call.name,
              content: `Tool call was not executed: the response ended early (${finishReason}).`,
              isError: true,
            })),
          });
        }
        // The stream's final usage reports input_tokens for the full transcript
        // we just sent, so it is an authoritative measure of used context —
        // mark it "provider" so compaction can act on it even when a provider
        // (e.g. Claude OAuth) cannot pre-count via countTokens.
        if (usage) yield { type: "context", status: this.statusFor(this.usedTokensOf(usage), "provider") };
        yield usage ? { type: "turn_end", usage } : { type: "turn_end" };
        return;
      }

      // Concurrency-safe calls that need no approval (reads, searches,
      // fetches) start together up front, so a step that reads five files
      // costs one file's latency instead of five. Events and results are still
      // produced in call order below; the loop just awaits the running promise.
      const prefetched = new Map<ToolCallPart, Promise<ToolResult>>();
      const parallelCalls = toolCalls.filter(
        (call) =>
          this.tools.get(call.name)?.concurrencySafe === true &&
          this.permissionFor(call.name, call.arguments) === "allow",
      );
      if (parallelCalls.length > 1) {
        for (const call of parallelCalls) {
          prefetched.set(call, this.runTool(call, signal));
        }
      }

      // Calls that declare what they will touch (e.g. sub-agents with the
      // files they own) run side by side when the declarations don't overlap:
      // each is announced and approved in order first, then all approved ones
      // start together. Otherwise they run one after another as usual.
      const decided = new Map<ToolCallPart, { permission: ToolPermission; approved: boolean }>();
      const claims = toolCalls
        .map((call) => ({ call, keys: this.tools.get(call.name)?.conflictKeys?.(call.arguments) }))
        .filter((entry): entry is { call: ToolCallPart; keys: string[] } => entry.keys !== undefined);
      if (claims.length > 1 && claims.every((a, i) => claims.every((b, j) => i === j || !ownershipOverlaps(a.keys, b.keys)))) {
        for (const { call } of claims) {
          yield { type: "tool_start", id: call.id, name: call.name, input: call.arguments };
          // A rejection that interrupted the turn must not keep prompting for
          // the rest of the group.
          const decision = signal?.aborted
            ? { permission: this.permissionFor(call.name, call.arguments), approved: false }
            : await this.decide(call);
          decided.set(call, decision);
        }
        for (const { call } of claims) {
          const decision = decided.get(call);
          if (decision?.approved && decision.permission !== "deny") prefetched.set(call, this.runTool(call, signal));
        }
      }

      // Execute every requested tool, feeding results back as one user turn.
      const resultBlocks: ContentPart[] = [];
      for (const call of toolCalls) {
        const early = decided.get(call);
        if (!early) {
          yield {
            type: "tool_start",
            id: call.id,
            name: call.name,
            input: call.arguments,
          };
        }
        const { permission, approved } = early ?? (await this.decide(call));

        let result;
        if (permission === "deny") {
          result = {
            content: this.planMode
              ? `Tool '${call.name}' is blocked in plan mode. Explore read-only and call present_plan before changing the workspace.`
              : `Tool '${call.name}' execution is denied by policy.`,
            isError: true,
          };
        } else if (!approved) {
          result = {
            content: `Tool '${call.name}' execution was denied by the user.`,
            isError: true,
          };
        } else {
          const prefetchedResult = prefetched.get(call);
          if (prefetchedResult) {
            result = await prefetchedResult;
          } else {
            // Run the tool while relaying its live output: the loop wakes on
            // either new output or completion, so output events are yielded
            // in between without waiting for the tool to finish.
            let pending = "";
            let wake: (() => void) | undefined;
            const running = this.runTool(call, signal, (chunk) => {
              pending += chunk;
              wake?.();
            });
            let settled: ToolResult | undefined;
            void running.then((value) => {
              settled = value;
              wake?.();
            });
            while (settled === undefined) {
              await new Promise<void>((resolve) => {
                wake = resolve;
                if (pending || settled !== undefined) resolve();
              });
              wake = undefined;
              if (pending && settled === undefined) {
                const chunk = pending;
                pending = "";
                yield { type: "tool_output", id: call.id, name: call.name, chunk };
                // Batch bursts of output into fewer, larger events.
                await sleep(OUTPUT_BATCH_MS);
              }
            }
            result = settled;
          }
          if (!result.isError && result.metadata?.diff) {
            for (const diff of result.metadata.diff) editedThisTurn.add(diff.path);
          }
          if (this.verificationMode === "after-edit" && !result.isError && result.metadata?.diff) {
            const files = result.metadata.diff.map((diff) => diff.path);
            if (files.length > 0) {
              const verification = await runVerification(this.cwd, files, {
                ...(signal ? { signal } : {}),
                ...(this.verificationSessionId ? { sessionId: this.verificationSessionId } : {}),
              });
              result = {
                ...result,
                content: `${result.content}\n\n${formatVerificationResult(verification)}`,
                ...(verification.status === "failed" || verification.status === "cancelled"
                  ? { isError: true }
                  : {}),
              };
            }
          }
        }

        yield {
          type: "tool_end",
          id: call.id,
          name: call.name,
          content: result.content,
          isError: result.isError ?? false,
          ...(result.metadata ? { metadata: result.metadata } : {}),
        };

        // The interruption landed while the tool was running (or was rejected
        // mid-approval): record the tool's outcome so the transcript stays
        // consistent, mark the interruption, and end the turn — no further
        // steps, no synthetic retry of a tool that never got to run.
        if (signal?.aborted) {
          resultBlocks.push({
            type: "tool_result",
            toolCallId: call.id,
            name: call.name,
            content: result.content,
            ...(result.isError ? { isError: true } : {}),
          });
          this.history.push({ role: "tool", content: resultBlocks });
          this.finalizeInterrupted();
          yield { type: "aborted" };
          return;
        }

        // A model stuck re-issuing the same failing call (unknown tool, invalid
        // arguments, policy denial, or a tool that keeps throwing) would burn
        // the whole maxSteps budget retrying it. Count identical failures and
        // give up on the turn once the same call has failed several times
        // consecutively — the user sees a clear error instead of a spinner.
        const callKey = `${call.name}:${JSON.stringify(call.arguments ?? {})}`;
        if (result.isError) {
          const failures = (this.repeatedToolFailures.get(callKey) ?? 0) + 1;
          this.repeatedToolFailures.set(callKey, failures);
          if (failures >= MAX_REPEATED_TOOL_FAILURES) {
            resultBlocks.push({
              type: "tool_result",
              toolCallId: call.id,
              name: call.name,
              content: result.content,
              ...(result.isError ? { isError: true } : {}),
            });
            this.history.push({ role: "tool", content: resultBlocks });
            yield {
              type: "error",
              message: `Tool '${call.name}' failed ${failures} consecutive times with identical arguments; ending the turn.`,
            };
            return;
          }
        } else {
          this.repeatedToolFailures.delete(callKey);
        }

        resultBlocks.push({
          type: "tool_result",
          toolCallId: call.id,
          name: call.name,
          content: result.content,
          ...(result.isError ? { isError: true } : {}),
        });
      }
      this.history.push({ role: "tool", content: resultBlocks });
    }

    yield {
      type: "error",
      message: `Reached max steps (${this.maxSteps}) without completing.`,
    };
  }

  /**
   * Run the project's quickest meaningful check, shown to the host as a
   * `verify` tool call. Returns the message to hand back to the model when it
   * failed, or undefined when it passed or there is nothing to run.
   */
  private async *runEndOfTurnCheck(signal?: AbortSignal): AsyncGenerator<AgentEvent, string | undefined> {
    const commands = await resolveVerificationCommands(this.cwd);
    const check =
      commands.find((c) => c.id === "typecheck") ??
      commands.find((c) => c.id === "build") ??
      commands[0];
    if (!check) return undefined;
    const id = `auto-check-${Date.now().toString(36)}`;
    const label = check.argv.join(" ");
    yield { type: "tool_start", id, name: "verify", input: { check: check.id, command: label, automatic: true } };
    const result = await runVerificationCommand(check, {
      timeoutMs: AUTO_CHECK_TIMEOUT_MS,
      ...(signal ? { signal } : {}),
    });
    const failed = result.status !== "passed" && result.status !== "cancelled";
    const tail = result.output.trim().split("\n").slice(-AUTO_CHECK_OUTPUT_LINES).join("\n");
    yield {
      type: "tool_end",
      id,
      name: "verify",
      content: `${label}: ${result.status}${tail ? `\n${tail}` : ""}`,
      isError: failed,
    };
    if (!failed) return undefined;
    return (
      `[automatic check] \`${label}\` failed after your edits:\n\n${tail}\n\n` +
      "Fix the cause, then finish. If the failure is unrelated to your change, say so instead of working around it."
    );
  }

  /** Resolve a call's permission and, when it asks, the user's decision. */
  private async decide(call: ToolCallPart): Promise<{ permission: ToolPermission; approved: boolean }> {
    const hasExplicitPolicy = this.permissions !== undefined;
    const permission = this.permissionFor(call.name, call.arguments);
    // Backward compatibility: without an explicit policy, an ask-level tool
    // is allowed when no approval bridge exists, matching the original
    // Agent behavior. With an explicit policy, ask requires approval.
    let approved = permission === "allow" || (!hasExplicitPolicy && permission === "ask" && !this.approveTool);
    if (permission === "ask" && this.approveTool) {
      try {
        const decision = await this.approveTool(call.name, call.arguments);
        approved = decision === true || decision === "allow" || decision === "always";
      } catch {
        approved = false;
      }
    }
    return { permission, approved };
  }

  /** The effective permission for a tool, honoring plan mode and an explicit policy. */
  private permissionFor(name: string, input?: unknown): ToolPermission {
    const tool = this.tools.get(name);
    if (this.planMode) {
      // Plan mode is read-only exploration. Read-only tools (and read-only
      // shell commands) are safe; everything that could change the workspace
      // waits for the plan to be accepted.
      if (tool?.readonly === true) return "allow";
      if (this.isReadOnlyShellCall(name, input)) return "allow";
      return "deny";
    }
    if (this.permissions !== undefined) {
      return resolveToolPermission(this.permissions, name, tool?.readonly ?? false);
    }
    return tool?.readonly ? "allow" : "ask";
  }

  /** A shell call whose command the existing classifiers consider read-only. */
  private isReadOnlyShellCall(name: string, input: unknown): boolean {
    if (name !== "exec" && name !== "PowerShell") return false;
    const command = (input as { command?: unknown } | null)?.command;
    if (typeof command !== "string" || command.trim() === "") return false;
    const semantics =
      name === "exec"
        ? classifyCommandSemantics(command)
        : classifyPowerShellCommandSemantics(command);
    return semantics.category === "read_only";
  }

  /** Execute one approved tool call with the agent's full tool context. */
  private runTool(
    call: ToolCallPart,
    signal?: AbortSignal,
    onOutput?: (chunk: string) => void,
  ): Promise<ToolResult> {
    return this.tools.execute(call.name, call.arguments, {
      cwd: this.cwd,
      readLedger: this.readLedger,
      fileState: this.fileState,
      toolCallId: call.id,
      toolSearch: (query, maxResults) => this.tools.searchDeferred(query, maxResults),
      activateTools: (names) => this.tools.activate(names),
      ...(signal ? { signal } : {}),
      ...(onOutput ? { onOutput } : {}),
      ...(this.askUser ? { askUser: this.askUser } : {}),
      ...(this.presentPlan ? { presentPlan: this.presentPlan } : {}),
      ...(this.runSubAgent ? { runSubAgent: this.runSubAgent } : {}),
      ...(this.onFilesChanged ? { onFilesChanged: this.onFilesChanged } : {}),
      ...(this.onWorkspaceChanged ? { onWorkspaceChanged: this.onWorkspaceChanged } : {}),
      ...(this.onSkillLoaded ? { onSkillLoaded: this.onSkillLoaded } : {}),
      ...(this.allowedSkills ? { allowedSkills: this.allowedSkills } : {}),
      ...(this.readTextFile ? { readTextFile: this.readTextFile } : {}),
      ...(this.writeTextFile ? { writeTextFile: this.writeTextFile } : {}),
    });
  }

  /**
   * Record a user interruption in the transcript so the next turn resumes from
   * a consistent state. Any text streamed before the abort is preserved as an
   * assistant message, followed by an interruption marker — mirroring how a
   * coding agent leaves the conversation after Esc.
   */
  private finalizeInterrupted(partialText?: string): void {
    const text = partialText?.trim();
    if (text) {
      this.history.push({ role: "assistant", content: [{ type: "text", text }] });
    }
    this.history.push({
      role: "user",
      content: [{ type: "text", text: INTERRUPTED_MARKER }],
    });
  }

  private effectiveSystemPrompt(): string | undefined {
    if (!this.planMode) return this.system;
    return this.system ? `${this.system}\n\n${PLAN_MODE_PROMPT}` : PLAN_MODE_PROMPT;
  }

  private generationConfig(signal?: AbortSignal) {
    const systemPrompt = this.effectiveSystemPrompt();
    return {
      model: this.model,
      ...(systemPrompt ? { systemPrompt } : {}),
      tools: this.tools.definitions(),
      ...(this.temperature !== undefined
        ? { temperature: this.temperature }
        : {}),
      ...(this.maxTokens ? { maxTokens: this.maxTokens } : {}),
      ...(this.reasoningEffort ? { reasoningEffort: this.reasoningEffort } : {}),
      ...(this.thinkingEnabled !== undefined ? { thinkingEnabled: this.thinkingEnabled } : {}),
      ...(signal ? { abortSignal: signal } : {}),
      promptCacheKey: this.promptCacheKey,
    };
  }

  private async contextStatusFor(messages: Message[]): Promise<ContextStatus> {
    // Counting can be expensive — on Claude OAuth there is no free
    // /count_tokens, so it costs a real inference round-trip. Memoize on the
    // transcript so repeated status reads (/context then /status, or a
    // re-render) don't each pay for it. Any edit to the history changes the
    // fingerprint and forces a fresh count.
    const fingerprint = this.countFingerprint(messages);
    let usage: TokenUsage | undefined;
    if (this.countCache?.fingerprint === fingerprint) {
      usage = this.countCache.usage;
    } else {
      try {
        usage = await this.provider.countTokens(messages, this.generationConfig());
      } catch {
        usage = undefined;
      }
      if (usage) this.countCache = { fingerprint, usage };
    }
    // A provider that can't count (no endpoint, e.g. OpenAI-compatible
    // servers) gets the anchored estimate: the last measured request plus
    // what changed since — never a stale usage from before a compaction.
    if (!usage) return this.estimatedStatus();
    return this.statusFor(this.usedTokensOf(usage), "provider");
  }

  /**
   * Cheap identity for a transcript + the settings that affect its token count.
   * Sizes rather than full text: hashing megabytes of transcript on every
   * status read would cost more than it saves, and any real edit changes a
   * length, a part count, or the trailing content.
   */
  private countFingerprint(messages: Message[]): string {
    const parts: string[] = [this.model, String(messages.length)];
    for (const message of messages) {
      parts.push(message.role, String(message.content.length));
      for (const part of message.content) {
        switch (part.type) {
          case "text":
            parts.push("t", String(part.text.length));
            break;
          case "tool_call":
            parts.push("c", part.id, String(JSON.stringify(part.arguments).length));
            break;
          case "tool_result":
            parts.push("r", part.toolCallId, String(part.content.length));
            break;
          case "image":
            parts.push("i", String(part.data.length));
            break;
          case "reasoning":
            parts.push("z", String(part.data.length));
            break;
        }
      }
    }
    return parts.join("|");
  }

  private shouldCompact(status: ContextStatus): boolean {
    if (!this.compaction.enabled) return false;
    // Decide purely from the same context numbers the UI already shows for
    // every provider (used vs. usable tokens). We deliberately do NOT gate on
    // tokenCounter === "provider": any available count is enough to act on, and
    // requiring "provider" made the trigger provider-specific — e.g. it never
    // fired on the very first turn or when a provider reports usage through a
    // path the UI accepts but this gate rejected.
    const trigger = this.compactionTrigger(status);
    if (!status.usedTokens || trigger === undefined) return false;
    // Still skip on genuinely short conversations: there's nothing worth
    // summarizing until there's history older than the recent turns we keep.
    if (this.history.length <= this.compaction.keepRecentTurns * 2) return false;
    return status.usedTokens >= trigger;
  }

  /**
   * After a compaction this turn, compact again only once the context has
   * grown by a meaningful share of the trigger: a summary that still leaves
   * the context above it must not be redone on every following step.
   */
  private grewSinceCompaction(status: ContextStatus, compactedAt: number | undefined): boolean {
    if (compactedAt === undefined) return true;
    const trigger = this.compactionTrigger(status);
    if (!status.usedTokens || trigger === undefined) return false;
    return status.usedTokens - compactedAt >= trigger * RECOMPACT_GROWTH_RATIO;
  }

  /**
   * Automatic compaction that never breaks the turn: if summarizing fails
   * (provider error, rate limit) the turn goes on with the full transcript,
   * and a later check — or the overflow recovery — tries again. Returns
   * undefined when nothing was compacted.
   */
  private async tryCompact(
    beforeTokens: number | undefined,
    opts: { force?: boolean; midTurn?: boolean; deep?: boolean },
  ): Promise<(CompactionResult & { status: ContextStatus }) | undefined> {
    try {
      const compacted = await this.compactHistory(beforeTokens, opts);
      return compacted.removedMessages > 0 ? compacted : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Make room after the provider rejected a request as too large: clear old
   * tool results, then compact as deeply as possible (older turns and this
   * turn's older steps). Returns whether the transcript shrank.
   */
  private async *recoverFromOverflow(): AsyncGenerator<AgentEvent, boolean> {
    const pruned = this.pruneOldToolResults() > 0;
    const before = this.estimatedStatus();
    const compacted = await this.tryCompact(before.usedTokens, { force: true, midTurn: true, deep: true });
    if (compacted) {
      const { status, ...result } = compacted;
      yield { type: "context_compacted", result };
      yield { type: "context", status };
      return true;
    }
    if (pruned) yield { type: "context", status: this.estimatedStatus() };
    return pruned;
  }

  /** Remember the real window a provider states in its overflow error. */
  private learnContextWindow(err: unknown): void {
    const window = contextWindowFromError(err);
    if (window === undefined) return;
    const current = this.currentModelInfo().contextWindow;
    if (current === undefined || window < current) this.learnedContextWindow = window;
  }

  /**
   * The context size at which the agent compacts: a share of the usable
   * window, capped by maxContextTokens. With an unknown window (typically a
   * local model) the cap alone applies, so compaction still happens.
   */
  private compactionTrigger(status: ContextStatus): number | undefined {
    const ratioTrigger = status.usableTokens ? status.usableTokens * this.compaction.thresholdRatio : undefined;
    const cap = this.compaction.maxContextTokens > 0 ? this.compaction.maxContextTokens : undefined;
    if (ratioTrigger === undefined) return cap;
    return cap === undefined ? ratioTrigger : Math.min(ratioTrigger, cap);
  }

  private shouldPruneToolResults(status: ContextStatus): boolean {
    if (!this.compaction.enabled) return false;
    const trigger = this.compactionTrigger(status);
    if (!status.usedTokens || trigger === undefined) return false;
    return status.usedTokens >= trigger * PRUNE_AT_RATIO;
  }

  /**
   * Replace the content of old, large tool results with a short note,
   * keeping the most recent ones intact. Runs in batches (only when enough
   * text would be freed) so the prompt-cache prefix is rewritten rarely.
   * Returns the estimated number of tokens freed.
   */
  private pruneOldToolResults(): number {
    const positions: Array<{ message: number; part: number }> = [];
    this.history.forEach((message, m) => {
      message.content.forEach((part, p) => {
        if (part.type === "tool_result") positions.push({ message: m, part: p });
      });
    });
    const candidates = positions.slice(0, Math.max(0, positions.length - KEEP_RECENT_TOOL_RESULTS)).filter(({ message, part }) => {
      const block = this.history[message]?.content[part];
      return block?.type === "tool_result" && block.content.length > PRUNE_MIN_RESULT_CHARS && !block.content.startsWith(PRUNED_PREFIX);
    });
    let freedChars = 0;
    const clearedCalls: string[] = [];
    for (const { message, part } of candidates) {
      const block = this.history[message]?.content[part];
      if (block?.type === "tool_result") freedChars += block.content.length;
    }
    if (freedChars < PRUNE_MIN_BATCH_CHARS) return 0;

    for (const { message, part } of candidates) {
      const msg = this.history[message]!;
      const block = msg.content[part];
      if (block?.type !== "tool_result") continue;
      clearedCalls.push(block.toolCallId);
      const content = [...msg.content];
      content[part] = {
        ...block,
        content: `${PRUNED_PREFIX} ${block.name} output (${block.content.length} chars) was cleared to save context. Call the tool again if you still need it.]`,
      };
      this.history[message] = { ...msg, content };
    }
    this.countCache = undefined;
    // A cleared read can no longer be pointed back to, and the model no
    // longer sees the content it would be editing.
    this.readLedger.forgetCalls(clearedCalls);
    this.fileState.forgetCalls(clearedCalls);
    // No bookkeeping needed for the context estimate: it measures the
    // transcript as it is now, so the shorter results already count.
    return Math.round(freedChars / this.charsPerToken);
  }

  /**
   * Compact the transcript. Returns the usual {@link CompactionResult} plus the
   * post-compaction {@link ContextStatus} it had to compute anyway, so callers
   * can report the new context size without paying for a second measurement.
   *
   * Normally the last keepRecentTurns user turns stay verbatim and everything
   * before them is summarized. That alone can't shrink a single long turn (one
   * request driving dozens of tool steps), so mid-turn the current turn's
   * older steps are summarized too when the older turns are not where the
   * bulk is: the request itself stays verbatim, followed by its most recent
   * steps.
   */
  private async compactHistory(
    beforeTokens?: number,
    opts: { force?: boolean; midTurn?: boolean; deep?: boolean } = {},
  ): Promise<CompactionResult & { status: ContextStatus }> {
    // On a short conversation the turn split is 0 (not enough turns yet). The
    // automatic path bails there unless the current turn can be split; a
    // manual /compact instead forces a split that keeps just the final user
    // turn verbatim, so it makes progress whenever there is older history.
    let splitIndex = findRecentTurnStart(this.history, this.compaction.keepRecentTurns);
    if (splitIndex <= 0 && opts.force) {
      splitIndex = findRecentTurnStart(this.history, 1);
    }
    const turnStart = lastUserIndex(this.history);
    const stepSplit = opts.midTurn ? this.currentTurnSplit(turnStart) : -1;
    const useStepSplit =
      stepSplit > 0 &&
      (opts.deep ||
        splitIndex <= 0 ||
        transcriptChars(this.history.slice(0, splitIndex)) <
          transcriptChars(this.history) * TURN_SPLIT_MIN_SHARE);

    if (!useStepSplit && splitIndex <= 0) {
      // Nothing changed, so the caller's pre-compaction view is still accurate:
      // reuse it rather than paying for a measurement of an untouched history.
      return {
        beforeTokens,
        afterTokens: beforeTokens,
        removedMessages: 0,
        keptMessages: this.history.length,
        summary: "Nothing to compact yet.",
        status: await this.cheapContextStatus(),
      };
    }

    let summary: string;
    let kept: Message[];
    if (useStepSplit) {
      // The request goes to the summarizer too (it needs the goal), and is
      // also kept verbatim right after the summary.
      const request = this.history[turnStart]!;
      summary = await this.summarizeMessages(this.history.slice(0, stepSplit), IN_PROGRESS_NOTE);
      kept = [request, ...this.history.slice(stepSplit)];
    } else {
      summary = await this.summarizeMessages(this.history.slice(0, splitIndex));
      kept = this.history.slice(splitIndex);
    }
    const removedMessages = this.history.length - kept.length;
    const summaryMessage: Message = {
      role: "system",
      content: [
        {
          type: "text",
          text: `Earlier conversation summary:\n${summary}`,
        },
      ],
    };
    this.history.splice(0, this.history.length, summaryMessage, ...kept);
    // Earlier reads now live only in the summary: re-reads must send content,
    // and the read-before-edit gate must see the file as unread.
    this.readLedger.clear();
    this.fileState.clear();
    // The transcript was rewritten wholesale; any memoized count is now stale.
    this.countCache = undefined;
    const after = await this.contextStatus();
    return {
      beforeTokens,
      ...(after.usedTokens !== undefined ? { afterTokens: after.usedTokens } : {}),
      removedMessages,
      keptMessages: kept.length,
      summary,
      status: after,
    };
  }

  /**
   * Where to split the current turn: the start of its most recent steps, so
   * older steps can be summarized. Always an assistant message, so every kept
   * tool result still follows the call that produced it. -1 when the turn is
   * too short to split.
   */
  private currentTurnSplit(turnStart: number): number {
    if (turnStart < 0) return -1;
    const steps: number[] = [];
    for (let i = turnStart + 1; i < this.history.length; i++) {
      if (this.history[i]?.role === "assistant") steps.push(i);
    }
    if (steps.length <= KEEP_RECENT_STEPS) return -1;
    return steps[steps.length - KEEP_RECENT_STEPS]!;
  }

  /**
   * Summarize a slice of the transcript. A slice too large for one request
   * (e.g. compacting only after the provider already rejected the context as
   * too long) is summarized in parts, each folding in the summary so far.
   */
  private async summarizeMessages(messages: Message[], note?: string): Promise<string> {
    const blocks = serializeForSummary(messages);
    const budget = this.summaryInputBudgetChars();
    let summary = "";
    for (const chunk of chunkBlocks(blocks, budget)) {
      summary = await this.summarizeChunk(chunk, summary, note);
    }
    return summary || "Earlier conversation was compacted, but the provider returned an empty summary.";
  }

  private async summarizeChunk(transcript: string, previous: string, note?: string): Promise<string> {
    const intro = previous
      ? `Summary of the conversation before the part below:\n${previous}\n\nThe conversation continues (fold it into one updated summary):\n\n`
      : "";
    const prompt = `${buildSummarizationPrompt()}${note ? `\n\n${note}` : ""}\n\n${intro}${transcript}`;
    const model = this.summarizationModel();
    // Deliberately no systemPrompt: the summarization prompt is self-contained,
    // and the agent's system prompt (identity, tool-use, skills, environment —
    // several thousand tokens) is both irrelevant to summarizing and unable to
    // hit the cache here, since this request usually runs on a different,
    // cheaper model and caches are model-scoped.
    const response = await this.provider.generate(
      [{ role: "user", content: [{ type: "text", text: prompt }] }],
      {
        model,
        maxTokens: Math.min(2048, this.currentModelInfo().maxOutputTokens ?? 2048),
      },
    );
    return response.content
      .filter((part): part is TextPart => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();
  }

  /** How much transcript one summarization request may carry, in chars. */
  private summaryInputBudgetChars(): number {
    const info = this.currentModelInfo();
    const usable = info.contextWindow ? this.usableInputTokens(info.contextWindow) : undefined;
    const window = usable ?? (this.compaction.maxContextTokens > 0 ? this.compaction.maxContextTokens : SUMMARY_INPUT_MAX_TOKENS);
    const tokens = Math.min(SUMMARY_INPUT_MAX_TOKENS, Math.floor(window * SUMMARY_INPUT_WINDOW_SHARE));
    return Math.max(MIN_SUMMARY_CHUNK_CHARS, Math.floor(tokens * this.charsPerToken));
  }

  /**
   * The model used for compaction summaries: the provider's cheapest known
   * model when available (and offered by this provider), else the main model.
   */
  private summarizationModel(): string {
    const candidate = SUMMARIZATION_MODEL_BY_PROVIDER[this.provider.info.id];
    if (candidate && this.provider.info.availableModels?.includes(candidate)) {
      return candidate;
    }
    return this.model;
  }

  /**
   * Total request size from a usage report. The sum (input + cache read +
   * cache write) is the total for providers whose `input_tokens` excludes
   * cached tokens (Claude, Gemini). OpenAI-family providers already include
   * cached tokens inside `input_tokens`/`prompt_tokens`, so adding them again
   * would double count and inflate the used-context percentage toward
   * premature compaction.
   */
  private usedTokensOf(usage: TokenUsage): number {
    return (
      usage.inputTokens +
      (this.provider.info.usageTokensIncludeCache
        ? 0
        : (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0))
    );
  }

  private statusFor(usedTokens: number, tokenCounter: ContextStatus["tokenCounter"]): ContextStatus {
    const info = this.currentModelInfo();
    const contextWindow = info.contextWindow;
    const usableTokens = contextWindow ? this.usableInputTokens(contextWindow) : undefined;
    const ratio = usableTokens ? usedTokens / usableTokens : undefined;
    const usedPercentage = ratio !== undefined ? Math.min(100, Math.max(0, Math.round(ratio * 100))) : undefined;
    const usage = this.lastUsage;
    return {
      model: this.model,
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(info.maxInputTokens !== undefined ? { maxInputTokens: info.maxInputTokens } : {}),
      ...(info.maxOutputTokens !== undefined ? { maxOutputTokens: info.maxOutputTokens } : {}),
      ...(info.source ? { source: info.source } : {}),
      tokenCounter,
      usedTokens,
      ...(usage
        ? {
            currentInputTokens: usage.inputTokens,
            currentOutputTokens: usage.outputTokens,
            currentCacheReadTokens: usage.cacheReadTokens ?? 0,
            currentCacheWriteTokens: usage.cacheWriteTokens ?? 0,
          }
        : {}),
      totalInputTokens: this.totalUsage.inputTokens,
      totalOutputTokens: this.totalUsage.outputTokens,
      totalCacheReadTokens: this.totalUsage.cacheReadTokens ?? 0,
      totalCacheWriteTokens: this.totalUsage.cacheWriteTokens ?? 0,
      ...(usableTokens !== undefined ? { usableTokens } : {}),
      ...(ratio !== undefined ? { ratio } : {}),
      ...(usedPercentage !== undefined ? { usedPercentage, remainingPercentage: 100 - usedPercentage } : {}),
    };
  }

  /**
   * Record a stream's usage. With the size of the transcript that request
   * carried, it also becomes the anchor for later context estimates, and
   * calibrates chars-per-token for this conversation's content.
   */
  private recordUsage(usage: TokenUsage, sentChars?: number): void {
    this.lastUsage = usage;
    this.totalUsage = {
      inputTokens: this.totalUsage.inputTokens + usage.inputTokens,
      outputTokens: this.totalUsage.outputTokens + usage.outputTokens,
      cacheReadTokens: (this.totalUsage.cacheReadTokens ?? 0) + (usage.cacheReadTokens ?? 0),
      cacheWriteTokens: (this.totalUsage.cacheWriteTokens ?? 0) + (usage.cacheWriteTokens ?? 0),
    };
    if (sentChars === undefined) return;
    const usedTokens = this.usedTokensOf(usage);
    // Some servers report zero prompt tokens; that measures nothing.
    if (usedTokens <= 0) return;
    this.usageAnchor = { usedTokens, historyChars: sentChars };
    // A tiny request says little about the tokenizer (per-message framing
    // dominates it); keep the previous ratio until there is real text.
    const requestChars = sentChars + this.overheadChars();
    if (requestChars < MIN_CALIBRATION_CHARS) return;
    this.charsPerToken = Math.min(MAX_CHARS_PER_TOKEN, Math.max(MIN_CHARS_PER_TOKEN, requestChars / usedTokens));
  }

  private usableInputTokens(contextWindow: number): number {
    const info = this.currentModelInfo();
    if (info.maxInputTokens !== undefined) {
      return info.maxInputTokens;
    }
    const reserved =
      this.compaction.reservedOutputTokens ??
      this.maxTokens ??
      Math.min(20_000, info.maxOutputTokens ?? Math.floor(contextWindow * 0.1));
    return Math.max(0, contextWindow - reserved);
  }
}

function formatVerificationResult(result: VerificationResult): string {
  if (result.checks.length === 0) return "Verification not run: no trusted checks found.";
  const checks = result.checks
    .map((check) => `${check.id}: ${check.status}${check.exitCode !== undefined && check.exitCode !== null ? ` (exit ${check.exitCode})` : ""}`)
    .join("\n");
  return `Automatic verification ${result.status}.\n${checks}`;
}

/**
 * Whether an error is an aborted-request signal. Covers the standard
 * DOMException "AbortError" plus the common shapes SDKs throw on cancellation.
 */
function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string; code?: string };
  if (e.name === "AbortError" || e.code === "ABORT_ERR") return true;
  return typeof e.message === "string" && /\baborted?\b/i.test(e.message);
}

/** A resumed history at least this large (estimated) is compacted before its first turn. */
const RESUME_COMPACT_MIN_TOKENS = 30_000;

/**
 * Size of a transcript in chars, the unit of the agent's token estimates.
 * Images have no text, so each counts as a typical image's token cost;
 * opaque reasoning state is left out.
 */
function transcriptChars(messages: Message[]): number {
  let chars = 0;
  for (const message of messages) {
    for (const part of message.content) {
      switch (part.type) {
        case "text":
          chars += part.text.length;
          break;
        case "tool_call":
          chars += part.name.length + JSON.stringify(part.arguments).length;
          break;
        case "tool_result":
          chars += part.content.length;
          break;
        case "image":
          chars += IMAGE_CHARS;
          break;
        case "reasoning":
          break;
      }
    }
  }
  return chars;
}

/** Default absolute compaction ceiling (see compaction.maxContextTokens). */
const DEFAULT_MAX_CONTEXT_TOKENS = 160_000;
// Old tool results are cleared once the context reaches this share of the
// compaction trigger. The newest results always stay intact, only large ones
// are cleared, and only when the batch frees a meaningful amount of text.
const PRUNE_AT_RATIO = 0.5;
const KEEP_RECENT_TOOL_RESULTS = 8;
const PRUNE_MIN_RESULT_CHARS = 2_000;
const PRUNE_MIN_BATCH_CHARS = 20_000;
const PRUNED_PREFIX = "[Earlier";
/** Default chars-per-token, until measured usage calibrates it. */
const CHARS_PER_TOKEN = 4;
// Bounds for the calibrated ratio: real tokenizers land around 3-4.5 on code
// and prose; anything outside means a server's usage report is off, not that
// the text is unusual.
const MIN_CHARS_PER_TOKEN = 2;
const MAX_CHARS_PER_TOKEN = 6;
/** Smallest request (chars) whose usage is trusted to calibrate the ratio. */
const MIN_CALIBRATION_CHARS = 4_000;
/** Rough token cost of one image, in the chars unit of transcriptChars. */
const IMAGE_CHARS = 1_500 * CHARS_PER_TOKEN;
/** Steps of the current turn kept verbatim when compaction splits that turn. */
const KEEP_RECENT_STEPS = 3;
/**
 * Mid-turn, the older turns must hold at least this share of the transcript
 * for a turn-only compaction to be worth it; otherwise the current turn's
 * older steps are summarized too.
 */
const TURN_SPLIT_MIN_SHARE = 0.3;
/** Growth (share of the trigger) needed before compacting again in the same turn. */
const RECOMPACT_GROWTH_RATIO = 0.25;
/** Cap on the transcript one summarization request carries, in tokens. */
const SUMMARY_INPUT_MAX_TOKENS = 100_000;
/** Share of the usable window one summarization request may fill. */
const SUMMARY_INPUT_WINDOW_SHARE = 0.5;
const MIN_SUMMARY_CHUNK_CHARS = 8_000;
const IN_PROGRESS_NOTE =
  "The last user request in this transcript is still being worked on and will be repeated verbatim after your summary, followed by the most recent steps. Summarize the progress made on it so far: what was done, what was found, and what remains.";

/** How many times a transient provider failure is retried per step. */
const MAX_TRANSIENT_RETRIES = 2;
// End-of-turn checks: at most this many per turn (a fix attempt each), each
// bounded in time, handing back this much of the failing output.
const MAX_AUTO_CHECKS = 2;
const AUTO_CHECK_TIMEOUT_MS = 5 * 60 * 1000;
const AUTO_CHECK_OUTPUT_LINES = 40;

export type VerificationMode = "manual" | "after-edit" | "end-of-turn";
// Minimum spacing between tool_output events for one call.
const OUTPUT_BATCH_MS = 100;
/** Base backoff for transient retries; doubles per attempt (500ms, 1s). */
const TRANSIENT_RETRY_BACKOFF_MS = 500;
/** Consecutive identical tool-call failures before the turn gives up. */
const MAX_REPEATED_TOOL_FAILURES = 3;

/**
 * Whether a provider error is worth a transparent retry: throttling (429),
 * server-side (5xx) and network-level failures are usually transient, while
 * 4xx validation/auth errors are deterministic and must surface immediately.
 */
function isTransientError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /(^|\D)(429|5\d\d)(\D|$)|timeout|timed out|econnreset|etimedout|eai_again|network error|temporarily unavailable|overloaded|rate limit/i.test(
    message,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findRecentTurnStart(messages: Message[], keepRecentTurns: number): number {
  let seenUsers = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role !== "user") continue;
    seenUsers += 1;
    if (seenUsers === keepRecentTurns) return i;
  }
  return 0;
}

function lastUserIndex(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return i;
  }
  return -1;
}

/** One serialized block per message, numbered in transcript order. */
function serializeForSummary(messages: Message[]): string[] {
  return messages.map((message, index) => {
    const content = message.content.map(serializePart).filter(Boolean).join("\n");
    return `#${index + 1} ${message.role}\n${content}`;
  });
}

/** Group serialized blocks into transcripts of at most `budget` chars each. */
function chunkBlocks(blocks: string[], budget: number): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const raw of blocks) {
    const block = truncate(raw, budget);
    if (current && current.length + block.length + 2 > budget) {
      chunks.push(current);
      current = "";
    }
    current = current ? `${current}\n\n${block}` : block;
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Whether a provider error says the request exceeded the model's context.
 * Covers the wordings of OpenAI, OpenAI-compatible servers (vLLM, llama.cpp,
 * LM Studio, gateways), Anthropic and Gemini.
 */
function isContextOverflowError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /context[_ ]length[_ ]exceeded|maximum context length|context window|exceeds? (the )?(available |maximum )?context|context size|prompt is too long|input is too long|too many (input |prompt )?tokens|reduce the length of the (messages|prompt)|input token count.*exceeds/i.test(
    message,
  );
}

/** The context window an overflow error states, when it states one. */
function contextWindowFromError(err: unknown): number | undefined {
  const message = err instanceof Error ? err.message : String(err);
  const patterns = [
    /maximum context length is (\d+)/i,
    /context (?:length|size|window)(?: of| is|:)? (\d+)/i,
    /n_ctx(?:_slot)?["']?\s*[:=]\s*(\d+)/i,
    /> ?(\d+) (?:tokens )?maximum/i,
    /maximum (?:number of tokens allowed|input tokens?)(?: is)? \(?(\d+)/i,
  ];
  for (const pattern of patterns) {
    const value = Number(pattern.exec(message)?.[1]);
    if (Number.isFinite(value) && value >= MIN_LEARNED_CONTEXT_WINDOW) return value;
  }
  return undefined;
}

/** Smaller "windows" parsed from an error are more likely other numbers. */
const MIN_LEARNED_CONTEXT_WINDOW = 1_024;

function serializePart(part: ContentPart): string {
  switch (part.type) {
    case "text":
      return truncate(part.text, 12_000);
    case "tool_call":
      return `tool_call ${part.name} ${truncate(JSON.stringify(part.arguments), 4_000)}`;
    case "tool_result":
      return `tool_result ${part.name} ${part.isError ? "(error) " : ""}${truncate(part.content, 8_000)}`;
    case "image":
      return `[image ${part.mimeType}, ${part.data.length} base64 chars omitted]`;
    case "reasoning":
      // Opaque provider state: nothing a summary could use.
      return "";
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[truncated ${text.length - max} chars during compaction]`;
}

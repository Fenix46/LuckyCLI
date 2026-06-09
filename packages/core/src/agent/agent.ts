import type { IProvider } from "../providers/IProvider.js";
import type {
  ContentPart,
  FinishReason,
  ModelInfo,
  Message,
  ProviderStatus,
  TextPart,
  ToolCallPart,
  TokenUsage,
} from "../providers/types.js";
import { modelInfo } from "../providers/catalog.js";
import { resolveToolPermission, type ToolPermissionPolicy } from "../tools/permissions.js";
import type { ToolRegistry } from "../tools/registry.js";
import type {
  AskUserRequest,
  SpawnAgentRequest,
  SpawnAgentResult,
} from "../tools/types.js";
import type { PlanDecision, PlanProposal } from "./plan.js";
import { buildSummarizationPrompt } from "../prompts/index.js";
import type { AgentEvent, CompactionResult, ContextStatus } from "./types.js";

const INTERRUPTED_MARKER = "[Request interrupted by user]";
// Compaction summaries are a mechanical, low-stakes task: run them on the
// cheapest model the provider exposes rather than the (possibly Opus-class)
// model driving the conversation. Falls back to the main model if the provider
// has no cheaper option.
const SUMMARIZATION_MODEL_BY_PROVIDER: Record<string, string> = {
  claude: "claude-haiku-4-5-20251001",
  "openai-oauth": "gpt-5.4-mini",
  antigravity: "gemini-3.5-flash-low",
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
  /** Prior conversation to resume from. Copied into the history on construction. */
  messages?: Message[];
}

export type ToolApproval = "allow" | "always" | "deny" | boolean;

interface RequiredCompactionConfig {
  enabled: boolean;
  thresholdRatio: number;
  keepRecentTurns: number;
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
  private readonly maxSteps: number | undefined;
  private readonly compaction: RequiredCompactionConfig;
  private readonly modelInfo: ModelInfo;
  private readonly permissions: ToolPermissionPolicy | undefined;
  private readonly approveTool: ((name: string, input: unknown) => Promise<ToolApproval> | ToolApproval) | undefined;
  private readonly askUser: ((request: AskUserRequest) => Promise<string>) | undefined;
  private readonly presentPlan: ((plan: PlanProposal) => Promise<PlanDecision>) | undefined;
  private readonly runSubAgent: ((request: SpawnAgentRequest, signal?: AbortSignal) => Promise<SpawnAgentResult>) | undefined;
  private readonly onFilesChanged: ((paths: string[]) => void) | undefined;
  private lastUsage: TokenUsage | undefined;
  private totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
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
    this.maxSteps = cfg.maxSteps;
    this.compaction = {
      enabled: cfg.compaction?.enabled ?? true,
      thresholdRatio: cfg.compaction?.thresholdRatio ?? 0.75,
      keepRecentTurns: cfg.compaction?.keepRecentTurns ?? 6,
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
    if (cfg.messages?.length) this.history.push(...cfg.messages);
  }

  /** The conversation so far. Useful for persistence or inspection. */
  get messages(): readonly Message[] {
    return this.history;
  }

  /** Cumulative token usage across every turn this agent has run. */
  get totalTokenUsage(): TokenUsage {
    return { ...this.totalUsage };
  }

  private currentModelInfo(): ModelInfo {
    return this.provider.info.models?.[this.model] ?? this.modelInfo;
  }

  async contextStatus(): Promise<ContextStatus> {
    return this.contextStatusFor(this.history);
  }

  /**
   * Context status for the routine per-turn compaction check, without a billed
   * round-trip. Reuses the last stream's usage (an authoritative measure of the
   * transcript we sent) when available; only falls back to a real count on the
   * very first turn, before any usage has been observed.
   */
  private async cheapContextStatus(): Promise<ContextStatus> {
    if (this.lastUsage) {
      return this.contextStatusFromUsage(this.lastUsage, undefined, "provider");
    }
    return this.contextStatus();
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

  async compactNow(): Promise<CompactionResult> {
    // Manual /compact is an explicit user request: compress now whenever there
    // is anything to compress, even on a short conversation that hasn't yet
    // grown past keepRecentTurns. The automatic path stays threshold-gated.
    return this.compactHistory(undefined, { force: true });
  }

  /** Run one user turn to completion, yielding events as work progresses. */
  async *send(
    userInput: string,
    signal?: AbortSignal,
  ): AsyncIterable<AgentEvent> {
    this.history.push({
      role: "user",
      content: [{ type: "text", text: userInput }],
    });

    // Use the cheap, already-known context size for the routine pre-turn check.
    // The previous stream's final usage measured the full transcript we sent, so
    // it is an authoritative count — and reusing it avoids a real billed probe
    // (Claude OAuth has no free /count_tokens; it would re-send the whole
    // transcript) on every single turn. A real count only happens on demand
    // (/context, /status) or as a fallback when there is no prior usage yet.
    const beforeStatus = await this.cheapContextStatus();
    yield { type: "context", status: beforeStatus };
    if (this.shouldCompact(beforeStatus)) {
      const result = await this.compactHistory(beforeStatus.usedTokens);
      yield { type: "context_compacted", result };
      yield { type: "context", status: await this.contextStatus() };
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

      let finishReason: FinishReason = "stop";
      let usage: TokenUsage | undefined;
      const toolCalls: ToolCallPart[] = [];
      let textBuf = "";

      try {
        for await (const chunk of this.provider.generateStream(
          [...this.history],
          this.generationConfig(signal),
        )) {
          if (chunk.textDelta) {
            textBuf += chunk.textDelta;
            yield { type: "text", delta: chunk.textDelta };
          }
          if (chunk.reasoning) yield { type: "reasoning" };
          if (chunk.toolCall) toolCalls.push(chunk.toolCall);
          if (chunk.finishReason) finishReason = chunk.finishReason;
          if (chunk.usage) usage = chunk.usage;
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
      if (assistantBlocks.length > 0) {
        this.history.push({ role: "assistant", content: assistantBlocks });
      }

      if (usage) this.recordUsage(usage);

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
        if (usage) yield { type: "context", status: this.contextStatusFromUsage(usage, undefined, "provider") };
        yield usage ? { type: "turn_end", usage } : { type: "turn_end" };
        return;
      }

      // Execute every requested tool, feeding results back as one user turn.
      const resultBlocks: ContentPart[] = [];
      for (const call of toolCalls) {
        yield {
          type: "tool_start",
          id: call.id,
          name: call.name,
          input: call.arguments,
        };

        const tool = this.tools.get(call.name);
        const hasExplicitPolicy = this.permissions !== undefined;
        const permission = hasExplicitPolicy
          ? resolveToolPermission(this.permissions, call.name, tool?.readonly ?? false)
          : tool?.readonly
            ? "allow"
            : "ask";

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

        let result;
        if (permission === "deny") {
          result = {
            content: `Tool '${call.name}' execution is denied by policy.`,
            isError: true,
          };
        } else if (!approved) {
          result = {
            content: `Tool '${call.name}' execution was denied by the user.`,
            isError: true,
          };
        } else {
          result = await this.tools.execute(call.name, call.arguments, {
            cwd: this.cwd,
            ...(signal ? { signal } : {}),
            ...(this.askUser ? { askUser: this.askUser } : {}),
            ...(this.presentPlan ? { presentPlan: this.presentPlan } : {}),
            ...(this.runSubAgent ? { runSubAgent: this.runSubAgent } : {}),
            ...(this.onFilesChanged ? { onFilesChanged: this.onFilesChanged } : {}),
          });
        }

        yield {
          type: "tool_end",
          id: call.id,
          name: call.name,
          content: result.content,
          isError: result.isError ?? false,
        };
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

  private generationConfig(signal?: AbortSignal) {
    return {
      model: this.model,
      ...(this.system ? { systemPrompt: this.system } : {}),
      tools: this.tools.definitions(),
      ...(this.temperature !== undefined
        ? { temperature: this.temperature }
        : {}),
      ...(this.maxTokens ? { maxTokens: this.maxTokens } : {}),
      ...(this.reasoningEffort ? { reasoningEffort: this.reasoningEffort } : {}),
      ...(this.thinkingEnabled !== undefined ? { thinkingEnabled: this.thinkingEnabled } : {}),
      ...(signal ? { abortSignal: signal } : {}),
    };
  }

  private async contextStatusFor(messages: Message[]): Promise<ContextStatus> {
    let usage: TokenUsage | undefined;
    try {
      usage = await this.provider.countTokens(messages, this.generationConfig());
    } catch {
      usage = undefined;
    }
    const info = this.currentModelInfo();
    const contextWindow = info.contextWindow;
    const maxInputTokens = info.maxInputTokens;
    const maxOutputTokens = info.maxOutputTokens;
    const base: ContextStatus = {
      model: this.model,
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(maxInputTokens !== undefined ? { maxInputTokens } : {}),
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      ...(info.source ? { source: info.source } : {}),
      tokenCounter: "unavailable",
    };

    // If pre-counting failed, fall back to the last stream usage. That usage
    // measured the full transcript actually sent, so it is authoritative for
    // compaction — mark it "provider", not "usage".
    if (!usage) return this.lastUsage ? this.contextStatusFromUsage(this.lastUsage, undefined, "provider") : base;
    return this.contextStatusFromUsage(usage, { ...base, tokenCounter: "provider" });
  }

  private shouldCompact(status: ContextStatus): boolean {
    if (!this.compaction.enabled) return false;
    // Decide purely from the same context numbers the UI already shows for
    // every provider (used vs. usable tokens). We deliberately do NOT gate on
    // tokenCounter === "provider": any available count is enough to act on, and
    // requiring "provider" made the trigger provider-specific — e.g. it never
    // fired on the very first turn or when a provider reports usage through a
    // path the UI accepts but this gate rejected.
    if (!status.usedTokens || !status.usableTokens) return false;
    // Still skip on genuinely short conversations: there's nothing worth
    // summarizing until there's history older than the recent turns we keep.
    if (this.history.length <= this.compaction.keepRecentTurns * 2) return false;
    return status.usedTokens >= status.usableTokens * this.compaction.thresholdRatio;
  }

  private async compactHistory(
    beforeTokens?: number,
    opts: { force?: boolean } = {},
  ): Promise<CompactionResult> {
    // Normally we keep the last keepRecentTurns user turns verbatim and compact
    // everything before them. On a short conversation that split point is 0
    // (not enough turns yet). The automatic path bails there — it only fires
    // when the context is genuinely large. A manual /compact instead forces a
    // split that keeps just the final user turn verbatim, so it always makes
    // progress as long as there is older history to summarize.
    let splitIndex = findRecentTurnStart(this.history, this.compaction.keepRecentTurns);
    if (splitIndex <= 0 && opts.force) {
      splitIndex = findRecentTurnStart(this.history, 1);
    }
    if (splitIndex <= 0) {
      return {
        beforeTokens,
        afterTokens: beforeTokens,
        removedMessages: 0,
        keptMessages: this.history.length,
        summary: "Nothing to compact yet.",
      };
    }

    const compactable = this.history.slice(0, splitIndex);
    const tail = this.history.slice(splitIndex);
    const summary = await this.summarizeMessages(compactable);
    const summaryMessage: Message = {
      role: "system",
      content: [
        {
          type: "text",
          text: `Earlier conversation summary:\n${summary}`,
        },
      ],
    };
    this.history.splice(0, this.history.length, summaryMessage, ...tail);
    const after = await this.contextStatus();
    return {
      beforeTokens,
      ...(after.usedTokens !== undefined ? { afterTokens: after.usedTokens } : {}),
      removedMessages: compactable.length,
      keptMessages: tail.length,
      summary,
    };
  }

  private async summarizeMessages(messages: Message[]): Promise<string> {
    const transcript = serializeForSummary(messages);
    const prompt = `${buildSummarizationPrompt()}\n\n${transcript}`;
    const model = this.summarizationModel();
    const response = await this.provider.generate(
      [{ role: "user", content: [{ type: "text", text: prompt }] }],
      {
        model,
        ...(this.system ? { systemPrompt: this.system } : {}),
        maxTokens: Math.min(2048, this.currentModelInfo().maxOutputTokens ?? 2048),
      },
    );
    const text = response.content
      .filter((part): part is TextPart => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();
    return text || "Earlier conversation was compacted, but the provider returned an empty summary.";
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

  private contextStatusFromUsage(
    usage: TokenUsage,
    base?: ContextStatus,
    tokenCounter: "provider" | "usage" = "usage",
  ): ContextStatus {
    const info = this.currentModelInfo();
    const contextWindow = base?.contextWindow ?? info.contextWindow;
    const usedTokens = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
    const usableTokens = contextWindow ? this.usableInputTokens(contextWindow) : undefined;
    const ratio = usableTokens ? usedTokens / usableTokens : undefined;
    const usedPercentage = ratio !== undefined ? Math.min(100, Math.max(0, Math.round(ratio * 100))) : undefined;
    return {
      ...(base ?? {
        model: this.model,
        ...(contextWindow !== undefined ? { contextWindow } : {}),
        ...(info.maxInputTokens !== undefined ? { maxInputTokens: info.maxInputTokens } : {}),
        ...(info.maxOutputTokens !== undefined ? { maxOutputTokens: info.maxOutputTokens } : {}),
        ...(info.source ? { source: info.source } : {}),
        tokenCounter,
      }),
      tokenCounter: base?.tokenCounter === "provider" ? "provider" : tokenCounter,
      usedTokens,
      currentInputTokens: usage.inputTokens,
      currentOutputTokens: usage.outputTokens,
      currentCacheReadTokens: usage.cacheReadTokens ?? 0,
      currentCacheWriteTokens: usage.cacheWriteTokens ?? 0,
      totalInputTokens: this.totalUsage.inputTokens,
      totalOutputTokens: this.totalUsage.outputTokens,
      totalCacheReadTokens: this.totalUsage.cacheReadTokens ?? 0,
      totalCacheWriteTokens: this.totalUsage.cacheWriteTokens ?? 0,
      ...(usableTokens !== undefined ? { usableTokens } : {}),
      ...(ratio !== undefined ? { ratio } : {}),
      ...(usedPercentage !== undefined ? { usedPercentage, remainingPercentage: 100 - usedPercentage } : {}),
    };
  }

  private recordUsage(usage: TokenUsage): void {
    this.lastUsage = usage;
    this.totalUsage = {
      inputTokens: this.totalUsage.inputTokens + usage.inputTokens,
      outputTokens: this.totalUsage.outputTokens + usage.outputTokens,
      cacheReadTokens: (this.totalUsage.cacheReadTokens ?? 0) + (usage.cacheReadTokens ?? 0),
      cacheWriteTokens: (this.totalUsage.cacheWriteTokens ?? 0) + (usage.cacheWriteTokens ?? 0),
    };
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

function findRecentTurnStart(messages: Message[], keepRecentTurns: number): number {
  let seenUsers = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role !== "user") continue;
    seenUsers += 1;
    if (seenUsers === keepRecentTurns) return i;
  }
  return 0;
}

function serializeForSummary(messages: Message[]): string {
  return messages
    .map((message, index) => {
      const content = message.content.map(serializePart).filter(Boolean).join("\n");
      return `#${index + 1} ${message.role}\n${content}`;
    })
    .join("\n\n");
}

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
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[truncated ${text.length - max} chars during compaction]`;
}

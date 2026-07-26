/**
 * Sequential sub-agent execution.
 *
 * Given a profile (provider + model + role) and a task, runSubAgent builds a
 * child Agent on that provider, runs it to completion, and returns a textual
 * report plus the token usage it consumed. Phase 1 is strictly sequential: one
 * sub-agent runs start-to-finish before control returns to the caller, so there
 * is never more than one writer on the filesystem.
 *
 * The child Agent reuses the same engine as the main agent — it is fully
 * provider-agnostic, so a sub-agent on Gemini and one on Claude differ only in
 * the provider instance and model string handed to the constructor.
 */

import { Agent } from "../agent/agent.js";
import { getProvider, resetProvider } from "../providers/registry.js";
import type {
  ProviderCredentials,
  ProviderId,
  TokenUsage,
} from "../providers/types.js";
import { isProviderId } from "../providers/types.js";
import { ToolRegistry } from "../tools/registry.js";
import { defaultToolRegistry } from "../tools/builtin/index.js";
import type { AgentProfile } from "./profiles.js";

export interface SubAgentRequest {
  /** The profile to run as. */
  profile: AgentProfile;
  /** The task instructions for the sub-agent. */
  task: string;
  /** Working directory the sub-agent is anchored to. */
  cwd: string;
  /**
   * Resolve credentials for a provider id. Injected so the host (CLI) decides
   * where credentials come from (stored config / env) and tests can stub it.
   * Return null/undefined when the user is not logged into that provider.
   */
  resolveCredentials: (
    provider: ProviderId,
  ) => ProviderCredentials | undefined | null;
  /** Base system prompt for the sub-agent (the profile persona is prepended). */
  system: string;
  /**
   * Optional explicit tool registry. Defaults to the built-in set minus the
   * tools a sub-agent cannot use (see {@link subAgentToolRegistry}).
   */
  tools?: ToolRegistry;
  /** Called after every sub-agent turn with its cumulative usage so far. */
  onUsage?: (usage: TokenUsage) => void;
  /** Forwarded to the sub-agent's tools (e.g. graph upkeep). */
  onFilesChanged?: (paths: string[]) => void;
}

export interface SubAgentResult {
  /** The sub-agent's final assistant text — relayed to the main agent. */
  report: string;
  /** Total tokens the sub-agent consumed. */
  usage: TokenUsage;
}

/**
 * Tools a sub-agent must not be given.
 *
 * All three depend on a bridge the child is never wired with, so today they
 * only ever return "no bridge configured" — but the model still sees them
 * advertised and can waste a turn calling one. Filtering them explicitly also
 * makes the no-recursion property a decision rather than an accident of
 * wiring: `spawn_agent` stays out even if `runSubAgent` is later threaded into
 * child agents for nested delegation.
 *
 * `ask_user` / `present_plan` are excluded because a sub-agent has no channel
 * to the human: it runs headless and reports back through its caller. A child
 * that needs clarification should say so in its report instead.
 */
const SUB_AGENT_EXCLUDED_TOOLS = new Set(["spawn_agent", "ask_user", "present_plan"]);

/** The default tool set minus the tools a sub-agent cannot meaningfully use. */
export function subAgentToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of defaultToolRegistry().list()) {
    if (SUB_AGENT_EXCLUDED_TOOLS.has(tool.name)) continue;
    registry.register(tool);
  }
  return registry;
}

/** Combine a profile persona with the base system prompt. */
function composeSystemPrompt(base: string, profile: AgentProfile): string {
  const role = `You are the "${profile.name}" sub-agent: ${profile.description}\n\nWork only on the task you are given, then report back concisely what you did and any key findings — the main agent relays your report, so include only the essentials.`;
  const persona = profile.systemPrompt?.trim();
  return [persona, role, base].filter(Boolean).join("\n\n");
}

/**
 * Run a single sub-agent to completion. Throws a clear error when the profile's
 * provider has no credentials (so the caller can tell the user to assign a
 * provider they're logged into in /agents).
 */
export async function runSubAgent(
  req: SubAgentRequest,
  signal?: AbortSignal,
): Promise<SubAgentResult> {
  const providerId = req.profile.provider;
  if (!isProviderId(providerId)) {
    throw new Error(
      `Sub-agent "${req.profile.name}" has an unknown provider "${providerId}".`,
    );
  }

  const credentials = req.resolveCredentials(providerId);
  if (!credentials) {
    throw new Error(
      `Sub-agent "${req.profile.name}" is assigned to provider "${providerId}", which you are not logged into. ` +
        `Open /agents and assign it a provider you have credentials for.`,
    );
  }

  // Reset any cached instance so a credential change takes effect, mirroring
  // buildAgent in the CLI runtime.
  resetProvider(providerId);
  const provider = getProvider(providerId, credentials);

  const agent = new Agent({
    provider,
    model: req.profile.model,
    tools: req.tools ?? subAgentToolRegistry(),
    system: composeSystemPrompt(req.system, req.profile),
    cwd: req.cwd,
    ...(req.onFilesChanged ? { onFilesChanged: req.onFilesChanged } : {}),
  });

  let report = "";

  for await (const event of agent.send(req.task, signal)) {
    switch (event.type) {
      case "text":
        report += event.delta;
        break;
      case "turn_end":
        // Report the agent's cumulative usage so the live panel reflects the
        // running total, not just this turn.
        req.onUsage?.(agent.totalTokenUsage);
        break;
      case "error":
        throw new Error(
          `Sub-agent "${req.profile.name}" failed: ${event.message}`,
        );
      case "aborted":
        return {
          report: report.trim() || "[sub-agent interrupted]",
          usage: agent.totalTokenUsage,
        };
      default:
        break;
    }
  }

  return { report: report.trim(), usage: agent.totalTokenUsage };
}

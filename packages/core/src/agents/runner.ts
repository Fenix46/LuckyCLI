/**
 * Sub-agent execution.
 *
 * Given a profile (provider + model + role) and a task, runSubAgent builds a
 * child Agent on that provider, runs it to completion, and returns a textual
 * report plus the token usage it consumed. One call runs one sub-agent; the
 * main agent loop may run several calls side by side when each declares the
 * files it owns and those don't overlap (see ownership.ts) — each child's file
 * tools are then restricted to its own files.
 *
 * The child Agent reuses the same engine as the main agent — it is fully
 * provider-agnostic, so a sub-agent on Gemini and one on Claude differ only in
 * the provider instance and model string handed to the constructor.
 */

import { existsSync } from "node:fs";
import { Agent } from "../agent/agent.js";
import { graphFilePath } from "../graph/store.js";
import { GraphContextEnricher } from "../graph/enrich.js";
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
import { restrictWrites } from "./ownership.js";
import {
  SYSTEM_PROMPT_SECTIONS,
  outputStyleSection,
  resolveSections,
  toolsSection,
} from "../prompts/index.js";
import { detectProjectFacts } from "../project-facts.js";
import {
  appendProjectInstructionsToSystemPrompt,
  loadProjectInstructions,
} from "../project-instructions.js";
import { listAvailableSkills } from "../skills/available.js";

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
  /**
   * Base system prompt for the sub-agent (the profile persona is prepended).
   * When omitted, one is composed for the sub-agent's own tool set (see
   * {@link subAgentBasePrompt}) — smaller than the main agent's.
   */
  system?: string;
  /**
   * Optional explicit tool registry. Defaults to the built-in set minus the
   * tools a sub-agent cannot use (see {@link subAgentToolRegistry}).
   */
  tools?: ToolRegistry;
  /** Called after every sub-agent turn with its cumulative usage so far. */
  onUsage?: (usage: TokenUsage) => void;
  /** Forwarded to the sub-agent's tools (e.g. graph upkeep). */
  onFilesChanged?: (paths: string[]) => void;
  /**
   * Files the sub-agent may write (paths, directories or globs). When set,
   * its file tools refuse writes anywhere else — what makes running several
   * sub-agents in parallel safe.
   */
  writableFiles?: string[];
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
 * `spawn_agent`, `ask_user` and `present_plan` depend on a bridge the child is
 * never wired with, so they would only ever return "no bridge configured" —
 * but the model still sees them advertised and can waste a turn calling one.
 * Filtering them explicitly also makes the no-recursion property a decision
 * rather than an accident of wiring: `spawn_agent` stays out even if
 * `runSubAgent` is later threaded into child agents for nested delegation.
 * `ask_user` / `present_plan` are out because a sub-agent has no channel to the
 * human: it runs headless and reports back through its caller.
 *
 * The task tools and `project_memory` act on state the user and the main agent
 * own (the session's task list, the project's saved notes). A child writing to
 * them would surprise both, and each schema costs tokens on every turn, so the
 * child reports instead and the main agent decides what to record.
 */
const SUB_AGENT_EXCLUDED_TOOLS = new Set([
  "spawn_agent",
  "ask_user",
  "present_plan",
  "task_create",
  "task_list",
  "task_get",
  "task_update",
  "project_memory",
]);

/** The default tool set minus the tools a sub-agent cannot meaningfully use. */
export function subAgentToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of defaultToolRegistry().list()) {
    if (SUB_AGENT_EXCLUDED_TOOLS.has(tool.name)) continue;
    registry.register(tool);
  }
  return registry;
}

/**
 * Sections a sub-agent does without: the tool guide repeats what the tool
 * schemas already say, and the output-style rules are for replies to a human —
 * a sub-agent's report goes to the main agent.
 */
const SUB_AGENT_SECTIONS = SYSTEM_PROMPT_SECTIONS.filter(
  (section) => section !== toolsSection && section !== outputStyleSection,
);

/**
 * The base system prompt for a sub-agent in `cwd`: the main agent's sections
 * minus {@link SUB_AGENT_SECTIONS}' exclusions, gated on the child's real tool
 * set and without the skills catalog, plus the project's own instructions
 * (AGENTS.md / CLAUDE.md) so the child follows the same rules.
 */
export function subAgentBasePrompt(
  cwd: string,
  model: string,
  tools: ToolRegistry,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const base = resolveSections(SUB_AGENT_SECTIONS, {
    environment: {
      cwd,
      os: `${process.platform} (${process.arch})`,
      date: new Date().toISOString().slice(0, 10),
    },
    model,
    enabledTools: new Set(tools.definitions().map((d) => d.name)),
    hasGraph: existsSync(graphFilePath(cwd)),
    hasSubAgents: false,
    hasSkills: listAvailableSkills(cwd).length > 0,
    project: detectProjectFacts(cwd),
    env,
  });
  return appendProjectInstructionsToSystemPrompt(base, loadProjectInstructions(cwd));
}

/** Combine a profile persona with the base system prompt. */
function composeSystemPrompt(base: string, profile: AgentProfile): string {
  const role = `You are the "${profile.name}" sub-agent: ${profile.description}\n\nWork only on the task you are given, then report back concisely what you did and any key findings — the main agent relays your report, so include only the essentials. Other sub-agents may be working at the same time: write only the files your task names, and if you need a change elsewhere, describe it in your report instead of making it.`;
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

  // A fresh enricher per run: the sub-agent's task usually names the symbols it
  // must work on, so the graph cards land exactly where they help most. Its
  // injected-set dies with the run — no cross-run dedup needed.
  const enricher = new GraphContextEnricher(req.cwd);
  const baseTools = req.tools ?? subAgentToolRegistry();
  const tools = req.writableFiles?.length ? restrictWrites(baseTools, req.writableFiles) : baseTools;
  const system = req.system ?? subAgentBasePrompt(req.cwd, req.profile.model, tools);
  const agent = new Agent({
    provider,
    model: req.profile.model,
    tools,
    system: composeSystemPrompt(system, req.profile),
    cwd: req.cwd,
    enrichTurn: (text) => enricher.enrich(text),
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

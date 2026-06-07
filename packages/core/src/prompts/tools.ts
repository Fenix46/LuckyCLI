import { defineSection } from "./section.js";
import type { PromptContext } from "./section.js";

/**
 * "Your tools" — explains, not just lists, the tools available this session.
 * Each group has a strategic paragraph plus a line per tool, and a group only
 * appears when at least one of its tools is actually enabled (read from
 * ctx.enabledTools), so the model never reads guidance for tools it can't call.
 *
 * This complements the per-tool JSON schemas the provider sees: the schemas say
 * what arguments a tool takes; this section says when to reach for it and how it
 * differs from its neighbors. Override the whole section with LUCKY_PROMPT_TOOLS.
 */

interface ToolLine {
  name: string;
  text: string;
}

interface ToolGroup {
  heading: string;
  intro: string;
  tools: ToolLine[];
  /** Extra gate beyond "a tool is enabled": e.g. delegation needs profiles. */
  requires?: (ctx: PromptContext) => boolean;
}

const GROUPS: ToolGroup[] = [
  {
    heading: "## Files",
    intro:
      "Always read a file before you edit it, so you change the exact current text. Use partial-edit tools for changes to an existing file; only write a whole file when it's new or you're deliberately replacing all of it.",
    tools: [
      { name: "read_file", text: "read a file (or a line range) before reasoning about or editing it." },
      { name: "edit_file", text: "make a targeted, partial edit to an existing file by matching exact text." },
      { name: "apply_patch", text: "apply a multi-hunk diff in one call when several edits across a file go together." },
      { name: "write_file", text: "create a new file or fully rewrite one. Never use it for a small change to an unread file." },
    ],
  },
  {
    heading: "## Search and navigation",
    intro:
      "When the project has a knowledge graph, treat it as your primary index. Use it to locate a symbol, see who calls it, and gauge the blast radius of a change before you touch anything — then confirm in the real file before editing. Fall back to text search only when the graph has no answer. Don't open many files at random to \"look around\" if the graph or a search can point you straight at the target.",
    tools: [
      { name: "graph_query", text: "find a symbol or file, and inspect callers, callees, and neighbors to understand impact." },
      { name: "graph_overview", text: "get a high-level map when the relevant area of the codebase is unclear." },
      { name: "grep", text: "search file contents by text or regex when the graph doesn't cover the need." },
      { name: "glob", text: "find files by name or path pattern when you don't know the exact path." },
      { name: "list_dir", text: "list a directory you already know exists — not for probing guessed paths." },
    ],
  },
  {
    heading: "## Shell",
    intro:
      "Prefer the dedicated tools above over shell commands when one fits — they let the user review your work and are safer. Reserve the shell for genuine system commands (running tests, git, build steps). Don't use it to read, edit, or search files when a dedicated tool exists.",
    tools: [
      { name: "exec", text: "run a non-interactive shell command. Use absolute paths when ambiguity matters." },
      { name: "PowerShell", text: "on Windows, prefer this for commands, file writes, quoting, paths, and redirection." },
    ],
  },
  {
    heading: "## Planning and work tracking",
    intro:
      "When the user asks you to plan (\"plan\", \"pianifica\", \"make a plan\") or the work is non-trivial (3+ steps, multiple files, architectural choices), plan before implementing: explore read-only, resolve open questions with ask_user, then present_plan. Do NOT edit files before the plan is approved; on accept its tasks are created automatically and you execute them. Skip planning for genuinely trivial requests. Keep work visible — the task tools are how the user follows your progress.",
    tools: [
      { name: "present_plan", text: "after exploring read-only and resolving open questions, present a plan for approval; on accept its tasks are created automatically." },
      { name: "task_create", text: "create the tasks for a non-trivial piece of work up front." },
      { name: "task_update", text: "mark exactly one task in_progress before starting it, and completed as soon as it's done — don't batch." },
      { name: "task_list", text: "review the current task list." },
      { name: "task_get", text: "read a single task's details." },
    ],
  },
  {
    heading: "## Delegation",
    intro:
      "When large work splits cleanly into parts that benefit from different models, delegate. Delegation is sequential: run one sub-agent to completion, read its report, then delegate the next part. The sub-agent can't see this conversation, so put everything it needs in the task. Prefer low-cost profiles for simple parts (e.g. docs). If a profile is on a provider the user isn't logged into, spawn_agent errors — tell the user to fix it in /agents.",
    // Only worth explaining when at least one sub-agent profile exists.
    requires: (ctx) => ctx.hasSubAgents === true,
    tools: [
      { name: "spawn_agent", text: "delegate a self-contained sub-task to a named profile (see the /agents menu) running on its own provider/model." },
    ],
  },
  {
    heading: "## Other",
    intro: "",
    tools: [
      { name: "http_fetch", text: "fetch external public content only when the task needs something not already in the project." },
      { name: "project_memory", text: "store durable, project-specific facts that should persist across sessions — never guesses, transient tasks, or secrets." },
      { name: "ask_user", text: "ask the human only for a genuine decision they must make, not for facts the repository can answer." },
    ],
  },
];

/** Build the section text for the tools actually enabled this session. */
export function buildToolsPrompt(ctx: PromptContext): string | null {
  const enabled = ctx.enabledTools;
  // No capability info → don't fabricate a tools section; the tool-use section
  // still carries the general strategy.
  if (!enabled || enabled.size === 0) return null;

  const blocks: string[] = [];
  for (const group of GROUPS) {
    if (group.requires && !group.requires(ctx)) continue;
    const lines = group.tools.filter((t) => enabled.has(t.name));
    if (lines.length === 0) continue;
    const body = lines.map((t) => `- ${t.name}: ${t.text}`).join("\n");
    blocks.push([group.heading, group.intro, body].filter(Boolean).join("\n"));
  }
  if (blocks.length === 0) return null;

  return [
    "# Your tools",
    "These are the tools available this session and when to reach for each. The tool schemas describe their arguments; this is about choosing the right one.",
    ...blocks,
  ].join("\n\n");
}

export const toolsSection = defineSection({
  name: "tools",
  envVar: "LUCKY_PROMPT_TOOLS",
  compute: (ctx: PromptContext) => buildToolsPrompt(ctx),
});

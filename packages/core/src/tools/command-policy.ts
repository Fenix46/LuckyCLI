import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyCommandSemantics } from "./builtin/exec.js";

/**
 * Per-command policy for the shell tools, on top of the per-tool permission.
 *
 * The tool-level policy can only say "exec asks" or "exec is allowed"; this
 * decides per command. Built-in risk rules flag commands whose effects leave
 * the machine or can't be taken back (pushes, publishes, deploys, piping a
 * download into a shell), destructive ones, and package/make scripts whose
 * body does any of that. User rules can allow, ask for or deny any command.
 */

export type CommandAction = "allow" | "ask" | "deny";

export interface CommandRules {
  /** Commands that never need approval (patterns, see matchesCommandPattern). */
  allow?: string[];
  /** Commands that always need approval, even in auto mode. */
  ask?: string[];
  /** Commands that are never run. */
  deny?: string[];
}

export interface CommandVerdict {
  action: CommandAction;
  /** Why a command needs approval or is blocked, in words for the prompt. */
  reason?: string;
  /** A user rule decided this (vs. a built-in risk rule, or nothing). */
  byRule: boolean;
}

const RISKS: Array<[RegExp, string]> = [
  [/\bgit\s+push\b/, "pushes to a remote repository"],
  [/\b(?:npm|pnpm|yarn|bun)\s+(?:publish|unpublish|deprecate)\b/, "publishes a package"],
  [/\bcargo\s+(?:publish|yank)\b/, "publishes a crate"],
  [/\b(?:twine\s+upload|gem\s+push|poetry\s+publish|uv\s+publish)\b/, "publishes a package"],
  [/\b(?:docker|podman)\s+(?:push|login)\b/, "pushes a container image"],
  [/\bgh\s+(?:release\s+create|pr\s+merge|repo\s+(?:delete|create))\b/, "changes a GitHub repository"],
  [/\bkubectl\s+(?:apply|delete|create|replace|patch|scale|rollout|drain)\b/, "changes a Kubernetes cluster"],
  [/\bhelm\s+(?:install|upgrade|uninstall|delete|rollback)\b/, "changes a Kubernetes release"],
  [/\bterraform\s+(?:apply|destroy|import)\b/, "changes cloud infrastructure"],
  [/\b(?:vercel|netlify|fly|flyctl|firebase|wrangler)\s+(?:deploy|publish)\b|\bvercel\b[^;&|]*--prod\b/, "deploys"],
  [/\b(?:curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^;&]*\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b/i, "runs a downloaded script"],
  [/\b(?:irm|iwr|Invoke-RestMethod|Invoke-WebRequest)\b[^;&]*\|\s*iex\b|\biex\s*\(/i, "runs a downloaded script"],
  [/\b(?:ba|z|da)?sh\s+<\(\s*(?:curl|wget)\b/, "runs a downloaded script"],
  [/(?:^|[;&|]\s*)(?:ba|z|da)?sh\s+-c\b|(?:^|[;&|]\s*)eval\b/, "runs an inline script"],
];

// How deep `npm run a` → `npm run b` → … is followed.
const MAX_SCRIPT_DEPTH = 3;

/** Decide how a shell command should be handled. */
export function evaluateCommand(command: string, cwd: string, rules: CommandRules = {}): CommandVerdict {
  return evaluate(command.trim(), cwd, rules, 0);
}

function evaluate(command: string, cwd: string, rules: CommandRules, depth: number): CommandVerdict {
  // A rule matching the whole command can deny or ask for it; it may only
  // allow it when it is a single command — otherwise `allow: npm test` (a
  // prefix pattern) would also allow `npm test && git push`.
  const parts = segments(command);
  const wholeRule = ruleFor(command, rules);
  const whole = wholeRule === "allow" && parts.length > 1 ? undefined : wholeRule;
  if (whole === "deny") return { action: "deny", reason: `matches your deny rule for \`${command}\``, byRule: true };
  if (whole === "ask") return { action: "ask", reason: `matches your ask rule for \`${command}\``, byRule: true };

  let verdict: CommandVerdict = { action: "allow", byRule: false };
  const wholeRisk = riskOf(command);
  if (wholeRisk && whole !== "allow") verdict = { action: "ask", reason: wholeRisk, byRule: false };

  for (const segment of parts) {
    const rule = ruleFor(segment, rules);
    if (rule === "deny") return { action: "deny", reason: `matches your deny rule for \`${segment}\``, byRule: true };
    if (rule === "allow" || whole === "allow") continue;
    if (rule === "ask") {
      verdict = stricter(verdict, { action: "ask", reason: `matches your ask rule for \`${segment}\``, byRule: true });
      continue;
    }
    const risk = riskOf(segment) ?? destructiveReason(segment);
    if (risk) {
      verdict = stricter(verdict, { action: "ask", reason: risk, byRule: false });
      continue;
    }
    if (depth < MAX_SCRIPT_DEPTH) {
      for (const body of scriptBodies(segment, cwd)) {
        const inner = evaluate(body.command, cwd, rules, depth + 1);
        if (inner.action === "deny") return { ...inner, reason: `runs ${body.label}, which ${inner.reason}` };
        if (inner.action === "ask") {
          verdict = stricter(verdict, { ...inner, reason: `runs ${body.label}, which ${inner.reason}` });
        }
      }
    }
  }
  if (whole === "allow" && verdict.action === "allow") return { action: "allow", byRule: true };
  return verdict;
}

function stricter(a: CommandVerdict, b: CommandVerdict): CommandVerdict {
  const rank = { allow: 0, ask: 1, deny: 2 } as const;
  return rank[b.action] > rank[a.action] ? b : a;
}

function riskOf(command: string): string | undefined {
  return RISKS.find(([re]) => re.test(command))?.[1];
}

function destructiveReason(command: string): string | undefined {
  const semantics = classifyCommandSemantics(command);
  return semantics.category === "destructive" ? `is destructive (${semantics.reason})` : undefined;
}

/** Split on `&&`, `||`, `;` and `|` (quotes respected), trimming each part. */
export function segments(command: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote) {
      current += ch;
      if (ch === quote && command[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ";" || ch === "|" || (ch === "&" && command[i + 1] === "&")) {
      if (current.trim()) out.push(current.trim());
      current = "";
      if ((ch === "&" || ch === "|") && command[i + 1] === ch) i++;
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/**
 * Does `pattern` cover `command`? A pattern with `*` is a glob over the whole
 * command; otherwise it matches the command itself or any longer command that
 * starts with it as whole words ("git push" covers "git push origin main" but
 * not "git pushy").
 */
export function matchesCommandPattern(pattern: string, command: string): boolean {
  const p = pattern.trim().replace(/\s+/g, " ");
  const c = command.trim().replace(/\s+/g, " ");
  if (!p) return false;
  if (p.includes("*")) {
    const re = p
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    return new RegExp(`^${re}$`).test(c);
  }
  return c === p || c.startsWith(`${p} `);
}

function ruleFor(command: string, rules: CommandRules): CommandAction | undefined {
  // Deny wins over ask, ask over allow, whatever order the lists come in.
  if (rules.deny?.some((p) => matchesCommandPattern(p, command))) return "deny";
  if (rules.ask?.some((p) => matchesCommandPattern(p, command))) return "ask";
  if (rules.allow?.some((p) => matchesCommandPattern(p, command))) return "allow";
  return undefined;
}

/**
 * The bodies of the package-manager or make scripts a command runs, so
 * `npm run clean` is judged by the `rm -rf dist` it executes. Unknown scripts
 * yield nothing (the command will simply fail).
 */
function scriptBodies(command: string, cwd: string): Array<{ label: string; command: string }> {
  const tokens = command.split(/\s+/).filter((t) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t));
  const [tool, first, second] = tokens;
  if (!tool) return [];

  if (tool === "npm" || tool === "pnpm" || tool === "yarn" || tool === "bun") {
    const builtIn: Record<string, string> = { t: "test", tst: "test", test: "test", start: "start" };
    const name =
      first === "run" || first === "run-script"
        ? second
        : first && builtIn[first]
          ? builtIn[first]
          : (tool === "yarn" || tool === "pnpm") && first && !first.startsWith("-")
            ? first
            : undefined;
    if (!name) return [];
    const script = readPackageScripts(cwd)[name];
    if (!script) return [];
    const hooks = [`pre${name}`, `post${name}`]
      .map((hook) => readPackageScripts(cwd)[hook])
      .filter((body): body is string => Boolean(body));
    return [script, ...hooks].map((body) => ({ label: `\`${tool} run ${name}\``, command: body }));
  }

  if (tool === "make") {
    const target = first && !first.startsWith("-") ? first : undefined;
    return makeRecipe(cwd, target).map((line) => ({ label: `\`make${target ? ` ${target}` : ""}\``, command: line }));
  }
  return [];
}

function readPackageScripts(cwd: string): Record<string, string> {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as { scripts?: Record<string, unknown> };
    const out: Record<string, string> = {};
    for (const [name, body] of Object.entries(pkg.scripts ?? {})) if (typeof body === "string") out[name] = body;
    return out;
  } catch {
    return {};
  }
}

function makeRecipe(cwd: string, target: string | undefined): string[] {
  const file = ["GNUmakefile", "makefile", "Makefile"].map((name) => join(cwd, name)).find(existsSync);
  if (!file) return [];
  let lines: string[];
  try {
    lines = readFileSync(file, "utf8").split("\n");
  } catch {
    return [];
  }
  // No target: make runs the first rule.
  const start = lines.findIndex((line) =>
    target ? new RegExp(`^${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`).test(line) : /^[A-Za-z0-9_.-]+\s*:(?!=)/.test(line),
  );
  if (start < 0) return [];
  const recipe: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("\t")) break;
    recipe.push(line.trim().replace(/^[@-]+/, ""));
  }
  return recipe;
}

/**
 * Parse LUCKY_COMMAND_RULES: `allow=npm test,git status;deny=git push --force*`.
 * Lists are separated by `;`, patterns within a list by `,`.
 */
export function parseCommandRulesEnv(value: string | undefined): CommandRules {
  const rules: CommandRules = {};
  if (!value?.trim()) return rules;
  for (const part of value.split(";")) {
    const [rawKey, ...rest] = part.split("=");
    const key = rawKey?.trim();
    if (!key) continue;
    if (key !== "allow" && key !== "ask" && key !== "deny") {
      throw new Error(`Invalid LUCKY_COMMAND_RULES list "${key}" (expected allow, ask or deny).`);
    }
    const patterns = rest.join("=").split(",").map((p) => p.trim()).filter(Boolean);
    rules[key] = [...(rules[key] ?? []), ...patterns];
  }
  return rules;
}

/** Stored rules plus environment rules (both apply). */
export function mergeCommandRules(...sources: Array<CommandRules | undefined>): CommandRules {
  const merged: CommandRules = {};
  for (const source of sources) {
    for (const key of ["allow", "ask", "deny"] as const) {
      const list = source?.[key];
      if (list?.length) merged[key] = [...(merged[key] ?? []), ...list];
    }
  }
  return merged;
}

import { posix } from "node:path";
import { ToolRegistry } from "../tools/registry.js";
import type { Tool } from "../tools/types.js";
import { parseUnifiedDiff } from "../tools/builtin/apply-patch.js";

/**
 * File ownership for sub-agents running in parallel. Each parallel sub-agent
 * declares the files it will write (paths, directories or globs); calls only
 * run together when those declarations don't overlap, and each sub-agent's
 * file tools refuse writes outside its own. Shell commands can't be policed
 * this way, which the spawn_agent guidance tells the model.
 */

function normalize(path: string): string {
  const cleaned = posix.normalize(path.replace(/\\/g, "/").trim()).replace(/^\.\//, "").replace(/\/+$/, "");
  return cleaned === "." ? "" : cleaned;
}

/** The literal directory/file prefix of a pattern ("src/ui/**" → "src/ui"). */
function base(pattern: string): string {
  const normalized = normalize(pattern);
  const star = normalized.indexOf("*");
  if (star < 0) return normalized;
  const literal = normalized.slice(0, star);
  return literal.includes("/") ? literal.slice(0, literal.lastIndexOf("/")) : "";
}

function globToRegExp(pattern: string): RegExp {
  const escaped = normalize(pattern)
    .split("**")
    .map((part) =>
      part
        .split("*")
        .map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]*"),
    )
    .join(".*");
  return new RegExp(`^${escaped}$`);
}

/** Is `path` covered by one of the owned patterns? */
export function isOwned(path: string, patterns: readonly string[]): boolean {
  const target = normalize(path);
  return patterns.some((pattern) => {
    const p = normalize(pattern);
    if (p.includes("*")) return globToRegExp(p).test(target);
    return p === "" || target === p || target.startsWith(`${p}/`);
  });
}

/** Could two ownership declarations touch the same file? (Conservative.) */
export function ownershipOverlaps(a: readonly string[], b: readonly string[]): boolean {
  for (const left of a) {
    for (const right of b) {
      const x = base(left);
      const y = base(right);
      if (x === "" || y === "" || x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)) return true;
    }
  }
  return false;
}

const WRITE_TOOLS = new Set(["write_file", "edit_file", "apply_patch"]);

function writeTargets(name: string, input: unknown): string[] {
  const record = (input ?? {}) as Record<string, unknown>;
  if (name === "apply_patch" && typeof record.patch === "string") {
    try {
      return parseUnifiedDiff(record.patch).map((file) => file.path);
    } catch {
      return []; // the tool itself reports the malformed patch
    }
  }
  return typeof record.path === "string" ? [record.path] : [];
}

/**
 * A copy of `registry` whose file-writing tools refuse paths outside `owned`.
 * Every other tool is passed through unchanged.
 */
export function restrictWrites(registry: ToolRegistry, owned: readonly string[]): ToolRegistry {
  const restricted = new ToolRegistry();
  for (const tool of registry.list()) {
    if (!WRITE_TOOLS.has(tool.name)) {
      restricted.register(tool);
      continue;
    }
    const guarded: Tool = {
      ...tool,
      async execute(input, ctx) {
        const outside = writeTargets(tool.name, input).filter((path) => !isOwned(path, owned));
        if (outside.length > 0) {
          return {
            content:
              `Refusing to write ${outside.join(", ")}: this sub-agent may only write ${owned.join(", ")} ` +
              "(other sub-agents are working in parallel). Report the change you need instead.",
            isError: true,
          };
        }
        return tool.execute(input, ctx);
      },
    };
    restricted.register(guarded);
  }
  return restricted;
}

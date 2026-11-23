/**
 * Argument completion for the built-in commands that take a known value.
 *
 * Only values the App already knows are suggested (themes, models, providers,
 * skills, MCP servers): no filesystem scanning, no network, nothing executed.
 * The caller replaces the `[replaceFrom, input.length)` slice with the chosen
 * value, so completing `/theme lu` yields `/theme lucky-dark`.
 */
export interface Completion {
  value: string;
  description?: string;
}

export interface CompletionState {
  items: Completion[];
  /** Index in the input where the token being completed starts. */
  replaceFrom: number;
  query: string;
}

export interface CompletionContext {
  themes: Array<{ id: string; name: string }>;
  models: string[];
  providers: string[];
  /** Every installed skill (enabled or not), for enable/disable/remove. */
  skills: string[];
  /** Enabled skills, for `/skill use`. */
  enabledSkills: string[];
  mcpServers: string[];
}

function filter(items: Completion[], query: string): Completion[] {
  const q = query.toLowerCase();
  if (!q) return items;
  return items.filter(
    (item) =>
      item.value.toLowerCase().includes(q) ||
      (item.description?.toLowerCase().includes(q) ?? false),
  );
}

function afterAction(rest: string, actions: readonly string[]): { action: string; query: string } | null {
  for (const action of actions) {
    if (rest.startsWith(`${action} `)) {
      return { action, query: rest.slice(action.length + 1) };
    }
  }
  return null;
}

/**
 * Completions for the token under the cursor, or null when the input is not a
 * command with a known argument provider (or already holds an exact value).
 */
export function argumentCompletions(
  input: string,
  context: CompletionContext,
): CompletionState | null {
  if (!input.startsWith("/")) return null;
  const space = input.indexOf(" ");
  if (space === -1) return null;
  const command = input.slice(0, space);
  const rest = input.slice(space + 1);

  let items: Completion[] | undefined;
  let query = rest;

  switch (command) {
    case "/theme":
      items = context.themes.map((theme) => ({ value: theme.id, description: theme.name }));
      break;
    case "/model":
      items = context.models.map((model) => ({ value: model }));
      break;
    case "/provider":
      items = context.providers.map((provider) => ({ value: provider }));
      break;
    case "/skill": {
      const parsed = afterAction(rest, ["use", "enable", "disable", "remove", "import"]);
      if (!parsed || parsed.action === "import") return null;
      query = parsed.query;
      items = (parsed.action === "use" ? context.enabledSkills : context.skills).map((name) => ({
        value: name,
      }));
      break;
    }
    case "/mcp": {
      const parsed = afterAction(rest, ["show", "inspect", "login", "logout", "remove"]);
      if (!parsed) return null;
      query = parsed.query;
      items = context.mcpServers.map((name) => ({ value: name }));
      break;
    }
    default:
      return null;
  }

  const matches = filter(items, query);
  if (matches.length === 0) return null;
  // The menu disappears once the typed value is exactly the only match.
  if (matches.length === 1 && matches[0]!.value === query) return null;

  return {
    items: matches,
    replaceFrom: Math.max(space + 1, input.length - query.length),
    query,
  };
}

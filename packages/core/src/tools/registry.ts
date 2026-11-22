import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ToolDefinition } from "../providers/types.js";

/** Defer marked tools once their schemas are this numerous or this large. */
const DEFERRED_MIN_COUNT = 5;
const DEFERRED_MIN_CHARS = 8_000;
const MAX_TOOL_SEARCH_RESULTS = 10;
import type { DeferredToolMatch, Tool, ToolContext, ToolResult } from "./types.js";

/**
 * Convert a tool's zod schema to the JSON Schema we advertise to providers.
 *
 * We target draft-07 (not OpenAPI 3.0): the `openApi3` target emits
 * `exclusiveMinimum: true` (a boolean, draft-04 style), which strict providers
 * such as DeepSeek (via opencode Zen) reject with
 * `true is not of type "number"`. Draft-07 emits the numeric form OpenAI and
 * DeepSeek both accept. We drop the `$schema` annotation since providers don't
 * use it (Gemini already strips its own unsupported keys downstream).
 */
function toToolParameters(schema: ZodTypeAny): Record<string, unknown> {
  const json = zodToJsonSchema(schema, {
    $refStrategy: "none",
  }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

/**
 * Holds the tools available to the agent and mediates between the canonical
 * layer (ToolDefinition / unknown input) and concrete, zod-validated tools.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();
  /**
   * JSON Schema is expensive to derive and never changes for a given tool, so
   * keep it per tool. Registering a new tool (e.g. a late MCP server) only has
   * to derive that tool's schema; the existing ones stay cached.
   */
  private readonly schemaCache = new WeakMap<Tool, Record<string, unknown>>();
  /** Every tool's definition, including deferred ones; invalidated by register. */
  private allDefinitionsCache: ToolDefinition[] | undefined;
  /** The subset advertised this step (deferred tools only once activated). */
  private activeDefinitionsCache: ToolDefinition[] | undefined;
  /** JSON.stringify(active definitions).length, used by the context estimate. */
  private definitionsLengthCache: number | undefined;
  /** Whether the deferred set is large enough to be worth hiding. */
  private deferralActiveCache: boolean | undefined;
  /** Deferred tools the model has discovered this session. */
  private readonly deferredActive = new Set<string>();

  register(tool: Tool): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
    this.invalidateDefinitions();
    return this;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Every registered tool, in registration order. */
  list(): Tool[] {
    return [...this.tools.values()];
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * Provider-facing definitions advertised this step. Tools marked `defer`
   * are omitted once their schemas are expensive enough; the model discovers
   * them with tool_search and they join the next request.
   */
  definitions(): ToolDefinition[] {
    if (this.activeDefinitionsCache !== undefined) return this.activeDefinitionsCache;
    const all = this.allDefinitions();
    if (!this.deferralActive()) {
      this.activeDefinitionsCache = all;
      return all;
    }
    const active = all.filter((definition) => {
      const tool = this.tools.get(definition.name);
      return tool?.defer !== true || this.deferredActive.has(definition.name);
    });
    this.activeDefinitionsCache = active;
    return active;
  }

  /**
   * Character length of the serialized definitions. The agent's context
   * estimate asks for this several times per step; serializing every schema
   * each time is pure CPU, so compute it once per registry revision.
   */
  definitionsJsonLength(): number {
    if (this.definitionsLengthCache === undefined) {
      this.definitionsLengthCache = JSON.stringify(this.definitions()).length;
    }
    return this.definitionsLengthCache;
  }

  /** True when some tools are currently hidden behind tool_search. */
  hasDeferredTools(): boolean {
    return this.deferralActive();
  }

  /**
   * Find deferred tools by name/description and return their full schemas.
   * Empty when nothing is deferred. Best matches first, capped at maxResults.
   */
  searchDeferred(query: string, maxResults = 5): DeferredToolMatch[] {
    if (!this.deferralActive()) return [];
    const limit = Number.isFinite(maxResults)
      ? Math.min(MAX_TOOL_SEARCH_RESULTS, Math.max(1, Math.floor(maxResults)))
      : 5;
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const scored: Array<{ tool: Tool; score: number }> = [];
    for (const tool of this.tools.values()) {
      if (tool.defer !== true || this.deferredActive.has(tool.name)) continue;
      const name = tool.name.toLowerCase();
      const description = tool.description.toLowerCase();
      let score = terms.length === 0 ? 1 : 0;
      for (const term of terms) {
        if (name === term) score += 100;
        else if (name.includes(term)) score += 30;
        if (description.includes(term)) score += 10;
      }
      if (score > 0) scored.push({ tool, score });
    }
    return scored
      .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
      .slice(0, limit)
      .map(({ tool }) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parametersSchema ?? this.schemaFor(tool),
      }));
  }

  /** Mark deferred tools active for the rest of the session. */
  activate(names: string[]): string[] {
    const activated: string[] = [];
    for (const name of names) {
      const tool = this.tools.get(name);
      if (tool?.defer !== true || this.deferredActive.has(name)) continue;
      this.deferredActive.add(name);
      activated.push(name);
    }
    if (activated.length > 0) {
      this.activeDefinitionsCache = undefined;
      this.definitionsLengthCache = undefined;
    }
    return activated;
  }

  private invalidateDefinitions(): void {
    this.allDefinitionsCache = undefined;
    this.activeDefinitionsCache = undefined;
    this.definitionsLengthCache = undefined;
    this.deferralActiveCache = undefined;
  }

  private allDefinitions(): ToolDefinition[] {
    if (this.allDefinitionsCache !== undefined) return this.allDefinitionsCache;
    const definitions = [...this.tools.values()].map((tool) => this.definitionFor(tool));
    this.allDefinitionsCache = definitions;
    return definitions;
  }

  private definitionFor(tool: Tool): ToolDefinition {
    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.parametersSchema ?? this.schemaFor(tool),
    };
  }

  private deferralActive(): boolean {
    if (this.deferralActiveCache !== undefined) return this.deferralActiveCache;
    const deferred = [...this.tools.values()].filter((tool) => tool.defer === true);
    if (deferred.length === 0) {
      this.deferralActiveCache = false;
      return false;
    }
    const chars = deferred.reduce(
      (total, tool) => total + JSON.stringify(this.definitionFor(tool)).length,
      0,
    );
    this.deferralActiveCache = deferred.length >= DEFERRED_MIN_COUNT || chars >= DEFERRED_MIN_CHARS;
    return this.deferralActiveCache;
  }

  private schemaFor(tool: Tool): Record<string, unknown> {
    const cached = this.schemaCache.get(tool);
    if (cached !== undefined) return cached;
    const schema = toToolParameters(tool.schema);
    this.schemaCache.set(tool, schema);
    return schema;
  }

  /**
   * Validate raw model-supplied input against the tool's schema and execute it.
   * Validation and execution errors are returned as error results (not thrown)
   * so the agent loop can feed them back to the model.
   */
  async execute(
    name: string,
    rawInput: unknown,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { content: `Unknown tool: ${name}`, isError: true };
    }

    const parsed = tool.schema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        content: `Invalid arguments for ${name}: ${parsed.error.message}`,
        isError: true,
      };
    }

    try {
      return await tool.execute(parsed.data, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Tool ${name} failed: ${message}`, isError: true };
    }
  }
}

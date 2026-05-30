import { zodToJsonSchema } from "zod-to-json-schema";
import type { ToolDefinition } from "../providers/types.js";
import type { Tool, ToolContext, ToolResult } from "./types.js";

/**
 * Holds the tools available to the agent and mediates between the canonical
 * layer (ToolDefinition / unknown input) and concrete, zod-validated tools.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** Provider-facing definitions for every registered tool. */
  definitions(): ToolDefinition[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: zodToJsonSchema(tool.schema, {
        target: "openApi3",
        $refStrategy: "none",
      }) as Record<string, unknown>,
    }));
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

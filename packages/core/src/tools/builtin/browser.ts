import { z } from "zod";
import { defineTool } from "../types.js";

const MAX_RESULT_CHARS = 20_000;

export const browserTool = defineTool({
  name: "browser",
  description:
    "Use the user's Chrome through the Lucky extension: list/open/activate/close tabs, " +
    "read the visible text of a page, click a CSS selector, or type into a field. " +
    "Requires the Lucky extension connected to this session (run /browser for the " +
    "port and token). Prefer this over http_fetch when the user is signed in or the " +
    "page needs their browser.",
  readonly: false,
  schema: z.object({
    action: z.enum(["tabs", "open", "activate", "close", "snapshot", "click", "type"]),
    tabId: z.number().int().positive().optional().describe("Target tab id (defaults to the active tab)."),
    url: z.string().url().optional().describe("URL for action=open."),
    selector: z.string().optional().describe("CSS selector for click/type."),
    text: z.string().optional().describe("Text to type."),
    submit: z.boolean().optional().describe("Press Enter / submit the form after typing."),
  }),
  async execute({ action, tabId, url, selector, text, submit }, ctx) {
    if (!ctx.browser) {
      return {
        content:
          "The Lucky Chrome bridge is not connected. Run /browser for the port and token, " +
          "then load the Lucky extension and enter them in its options.",
        isError: true,
      };
    }
    try {
      const result = await ctx.browser.request(methodFor(action), {
        ...(tabId !== undefined ? { tabId } : {}),
        ...(url !== undefined ? { url } : {}),
        ...(selector !== undefined ? { selector } : {}),
        ...(text !== undefined ? { text } : {}),
        ...(submit !== undefined ? { submit } : {}),
      });
      return { content: formatResult(action, result) };
    } catch (error) {
      return {
        content: `Browser action failed: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
  },
});

function methodFor(action: "tabs" | "open" | "activate" | "close" | "snapshot" | "click" | "type"): string {
  switch (action) {
    case "tabs":
      return "tabs.list";
    case "open":
      return "tabs.open";
    case "activate":
      return "tabs.activate";
    case "close":
      return "tabs.close";
    case "snapshot":
      return "page.snapshot";
    case "click":
      return "page.click";
    case "type":
      return "page.type";
  }
}

function formatResult(action: string, result: unknown): string {
  if (action === "snapshot" && typeof result === "object" && result !== null) {
    const snapshot = result as { title?: unknown; url?: unknown; text?: unknown };
    const title = typeof snapshot.title === "string" ? snapshot.title : "";
    const url = typeof snapshot.url === "string" ? snapshot.url : "";
    const text = typeof snapshot.text === "string" ? snapshot.text : "";
    return `${title ? `# ${title}\n` : ""}${url}\n\n${text}`.slice(0, MAX_RESULT_CHARS);
  }
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result, null, 2).slice(0, MAX_RESULT_CHARS);
  } catch {
    return String(result);
  }
}

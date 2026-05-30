import { z } from "zod";
import { defineTool } from "../types.js";

export const httpFetchTool = defineTool({
  name: "http_fetch",
  description:
    "Fetch and read the raw text content of a public URL (e.g. to inspect documentation, APIs or pages).",
  readonly: true,
  schema: z.object({
    url: z.string().url().describe("The complete HTTP or HTTPS URL to fetch."),
  }),
  async execute({ url }) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "luckycli/0.1.0",
        },
      });
      if (!res.ok) {
        return {
          content: `HTTP error! Status: ${res.status} ${res.statusText}`,
          isError: true,
        };
      }
      const text = await res.text();
      // Keep safety limits to avoid overflowing context windows
      const maxChars = 80_000;
      const truncated = text.length > maxChars;
      return {
        content: truncated
          ? `${text.slice(0, maxChars)}\n\n[truncated at ${maxChars} characters]`
          : text,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Fetch failed: ${message}`, isError: true };
    }
  },
});

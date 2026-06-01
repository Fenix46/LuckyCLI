import { z } from "zod";
import { defineTool } from "../types.js";

export const askUserTool = defineTool({
  name: "ask_user",
  description:
    "Ask the human user a clarifying question and wait for their answer. Use " +
    "this when requirements are ambiguous, a decision is needed, or proceeding " +
    "without confirmation would be risky. Provide concise options when useful.",
  readonly: true,
  schema: z.object({
    question: z.string().min(1).describe("The question to ask the user."),
    options: z
      .array(z.string().min(1))
      .max(10)
      .optional()
      .describe("Optional predefined answers the user can choose from."),
    allowFreeText: z
      .boolean()
      .optional()
      .describe("Whether the user may type a custom answer (default true)."),
  }),
  async execute({ question, options, allowFreeText }, ctx) {
    if (!ctx.askUser) {
      return {
        content:
          "Cannot ask the user in this environment: no interactive askUser bridge is configured.",
        isError: true,
      };
    }

    const answer = await ctx.askUser({
      question,
      ...(options?.length ? { options } : {}),
      allowFreeText: allowFreeText ?? true,
    });

    return { content: `User answered: ${answer}` };
  },
});

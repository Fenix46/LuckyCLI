import { z } from "zod";
import { defineTool } from "../types.js";

const TodoStatus = z.enum(["pending", "in_progress", "completed"]);
const TodoPriority = z.enum(["low", "medium", "high"]);

export type TodoItem = z.infer<typeof TodoItemSchema>;

const TodoItemSchema = z.object({
  id: z.string().optional().describe("Stable optional identifier for this todo."),
  content: z.string().min(1).describe("What needs to be done."),
  status: TodoStatus.describe("Current status of the todo."),
  priority: TodoPriority.optional().describe("Optional priority."),
});

const todosByCwd = new Map<string, TodoItem[]>();

export const todoWriteTool = defineTool({
  name: "todo_write",
  description:
    "Create or replace the session todo list for multi-step work. Use this to " +
    "track progress on non-trivial tasks. Provide the full current list every " +
    "time, with statuses pending, in_progress, or completed.",
  readonly: true,
  schema: z.object({
    todos: z
      .array(TodoItemSchema)
      .max(50)
      .describe("The full todo list to store for the current working session."),
  }),
  async execute({ todos }, ctx) {
    todosByCwd.set(ctx.cwd, todos);
    const counts = countByStatus(todos);
    const body = todos.length
      ? todos.map(formatTodo).join("\n")
      : "(todo list cleared)";
    return {
      content:
        `Todo list updated: ${counts.completed} completed, ` +
        `${counts.in_progress} in progress, ${counts.pending} pending.\n` +
        body,
    };
  },
});

export function getTodosForCwd(cwd: string): readonly TodoItem[] {
  return todosByCwd.get(cwd) ?? [];
}

function countByStatus(todos: TodoItem[]) {
  return todos.reduce(
    (acc, todo) => {
      acc[todo.status] += 1;
      return acc;
    },
    { pending: 0, in_progress: 0, completed: 0 },
  );
}

function formatTodo(todo: TodoItem): string {
  const priority = todo.priority ? `/${todo.priority}` : "";
  const id = todo.id ? ` ${todo.id}` : "";
  return `- [${todo.status}${priority}]${id} ${todo.content}`;
}

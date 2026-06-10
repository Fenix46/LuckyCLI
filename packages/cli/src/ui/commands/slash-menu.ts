/**
 * Static slash-menu catalog. Temporary: task 5 of APP_REFACTOR_PLAN.md
 * deletes this in favor of deriving the menu and /help from the registry.
 */
export const ALL_SLASH_COMMANDS = [
  { name: "/model", desc: "Switch model for the active provider" },
  { name: "/thinking", desc: "Toggle Claude adaptive thinking (/thinking on|off)" },
  { name: "/mcp", desc: "Open the interactive MCP control panel" },
  { name: "/agents", desc: "Manage sub-agent profiles (provider/model per role)" },
  { name: "/status", desc: "Show provider auth, account, quota and context status" },
  { name: "/update", desc: "Check for updates (/update apply, /update auto <mode>)" },
  { name: "/compact", desc: "Summarize older chat history now" },
  { name: "/resume", desc: "Pick a saved session to resume" },
  { name: "/provider", desc: "Switch provider and authenticate" },
  { name: "/theme", desc: "Choose terminal UI colors" },
  { name: "/graph", desc: "Build/refresh the project knowledge graph" },
  { name: "/task", desc: "View the work task list (/task clear to empty it)" },
  { name: "/exit", desc: "Exit the lucky agent session" },
];

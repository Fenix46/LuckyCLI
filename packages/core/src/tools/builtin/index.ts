import { ToolRegistry } from "../registry.js";
import { applyPatchTool } from "./apply-patch.js";
import { askUserTool } from "./ask-user.js";
import { editFileTool } from "./edit-file.js";
import { execTool } from "./exec.js";
import { globTool } from "./glob.js";
import { graphOverviewTool, graphQueryTool } from "./graph.js";
import { grepTool } from "./grep.js";
import { httpFetchTool } from "./http-fetch.js";
import { listDirTool } from "./list-dir.js";
import { presentPlanTool } from "./plan.js";
import { powerShellTool } from "./powershell.js";
import { projectMemoryTool } from "./project-memory.js";
import { readFileTool } from "./read-file.js";
import { skillLoadTool, skillSearchTool } from "./skills.js";
import { spawnAgentTool } from "./spawn-agent.js";
import {
  taskCreateTool,
  taskGetTool,
  taskListTool,
  taskUpdateTool,
} from "./tasks.js";
import { writeFileTool } from "./write-file.js";

/** A registry pre-loaded with the built-in tools. */
export function defaultToolRegistry(): ToolRegistry {
  return new ToolRegistry()
    .register(readFileTool)
    .register(writeFileTool)
    .register(editFileTool)
    .register(applyPatchTool)
    .register(execTool)
    .register(powerShellTool)
    .register(listDirTool)
    .register(globTool)
    .register(grepTool)
    .register(httpFetchTool)
    .register(taskCreateTool)
    .register(taskListTool)
    .register(taskGetTool)
    .register(taskUpdateTool)
    .register(presentPlanTool)
    .register(spawnAgentTool)
    .register(projectMemoryTool)
    .register(graphQueryTool)
    .register(graphOverviewTool)
    .register(skillSearchTool)
    .register(skillLoadTool)
    .register(askUserTool);
}

export {
  execTool,
  powerShellTool,
  readFileTool,
  writeFileTool,
  editFileTool,
  applyPatchTool,
  listDirTool,
  globTool,
  grepTool,
  httpFetchTool,
  taskCreateTool,
  taskListTool,
  taskGetTool,
  taskUpdateTool,
  presentPlanTool,
  spawnAgentTool,
  projectMemoryTool,
  graphQueryTool,
  graphOverviewTool,
  skillSearchTool,
  skillLoadTool,
  askUserTool,
};

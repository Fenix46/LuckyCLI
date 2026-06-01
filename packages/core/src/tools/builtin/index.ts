import { ToolRegistry } from "../registry.js";
import { applyPatchTool } from "./apply-patch.js";
import { askUserTool } from "./ask-user.js";
import { editFileTool } from "./edit-file.js";
import { execTool } from "./exec.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { httpFetchTool } from "./http-fetch.js";
import { listDirTool } from "./list-dir.js";
import { readFileTool } from "./read-file.js";
import { todoWriteTool } from "./todo-write.js";
import { writeFileTool } from "./write-file.js";

/** A registry pre-loaded with the built-in tools. */
export function defaultToolRegistry(): ToolRegistry {
  return new ToolRegistry()
    .register(readFileTool)
    .register(writeFileTool)
    .register(editFileTool)
    .register(applyPatchTool)
    .register(execTool)
    .register(listDirTool)
    .register(globTool)
    .register(grepTool)
    .register(httpFetchTool)
    .register(todoWriteTool)
    .register(askUserTool);
}

export {
  execTool,
  readFileTool,
  writeFileTool,
  editFileTool,
  applyPatchTool,
  listDirTool,
  globTool,
  grepTool,
  httpFetchTool,
  todoWriteTool,
  askUserTool,
};

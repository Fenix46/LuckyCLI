import { ToolRegistry } from "../registry.js";
import { editFileTool } from "./edit-file.js";
import { execTool } from "./exec.js";
import { httpFetchTool } from "./http-fetch.js";
import { listDirTool } from "./list-dir.js";
import { readFileTool } from "./read-file.js";
import { writeFileTool } from "./write-file.js";

/** A registry pre-loaded with the built-in tools. */
export function defaultToolRegistry(): ToolRegistry {
  return new ToolRegistry()
    .register(readFileTool)
    .register(writeFileTool)
    .register(editFileTool)
    .register(execTool)
    .register(listDirTool)
    .register(httpFetchTool);
}

export {
  execTool,
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirTool,
  httpFetchTool,
};

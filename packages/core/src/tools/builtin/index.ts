import { ToolRegistry } from "../registry.js";
import { execTool } from "./exec.js";
import { listDirTool } from "./list-dir.js";
import { readFileTool } from "./read-file.js";
import { writeFileTool } from "./write-file.js";

/** A registry pre-loaded with the built-in tools. */
export function defaultToolRegistry(): ToolRegistry {
  return new ToolRegistry()
    .register(readFileTool)
    .register(writeFileTool)
    .register(execTool)
    .register(listDirTool);
}

export { execTool, readFileTool, writeFileTool, listDirTool };

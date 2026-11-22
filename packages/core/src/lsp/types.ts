/** LSP configuration and the small surface the tool depends on. */

export interface LspServerConfig {
  /** Executable to spawn, e.g. `typescript-language-server`. */
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** Only stdio is supported today. */
  transport?: "stdio";
  initializationOptions?: unknown;
  /** Sent via workspace/didChangeConfiguration after initialization. */
  settings?: Record<string, unknown>;
  /**
   * Extension → LSP language id, e.g. `{ ".ts": "typescript", ".tsx": "typescriptreact" }`.
   * Also used to pick this server for a file.
   */
  extensionToLanguage?: Record<string, string>;
  /** Shorthand when the language id is not needed: [".py", ".pyi"]. */
  fileExtensions?: string[];
  /** Per-request timeout in milliseconds (default 15s). */
  timeoutMs?: number;
}

export type LspConfig = Record<string, LspServerConfig>;

export interface LoadedLspConfig {
  config: LspConfig;
  sources: string[];
  errors: string[];
}

export const LSP_OPERATIONS = [
  "diagnostics",
  "hover",
  "definition",
  "references",
  "symbols",
] as const;

export type LspOperation = (typeof LSP_OPERATIONS)[number];

export interface LspRequest {
  operation: LspOperation;
  /** File to inspect, relative to the working directory. */
  filePath?: string;
  /** 1-based line. */
  line?: number;
  /** 1-based character. */
  character?: number;
  /** Query for workspace symbols, or to filter document symbols. */
  query?: string;
}

export interface LspResult {
  /** Model-facing text, already formatted and bounded. */
  text: string;
  /** True when the operation completed but found nothing. */
  empty?: boolean;
  /** Server name, for the tool's report. */
  server?: string;
}

/** The interface the tool uses; tests supply a fake. */
export interface LspService {
  execute(request: LspRequest): Promise<LspResult>;
  dispose(): Promise<void>;
}

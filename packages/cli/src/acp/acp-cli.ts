/**
 * The `lucky acp` subcommand: serve the Agent Client Protocol over stdio so
 * an ACP editor (Zed, JetBrains, Neovim/Emacs plugins, VS Code ACP
 * extensions) can spawn LuckyCLI as its coding agent.
 *
 * stdout belongs to the protocol (newline-delimited JSON-RPC); every
 * human-facing line goes to stderr. Config resolution is strictly headless:
 * provider, model and credentials come from flags/stored config/env exactly
 * like the TUI, but instead of opening the interactive setup on a missing
 * piece we exit with instructions — the editor is no place for a login flow.
 */
import { parseArgs } from "node:util";
import { resolveConfig, type ResolvedConfig } from "@luckycli/core";
import type { AgentSideConnection } from "@zed-industries/agent-client-protocol";
import { AUTH_GUIDANCE, LuckyAcpAgent, serveAcp, stdioStream } from "./server.js";

/** Outcome of headless config resolution: a usable config, or a human reason. */
export type AcpConfigResult =
  | { ok: true; config: ResolvedConfig }
  | { ok: false; reason: string };

/**
 * Resolve the agent configuration without any interactive fallback.
 * `resolve` is injectable so tests run against a fake stored config.
 */
export function resolveAcpConfig(
  flags: { provider?: string; model?: string },
  resolve: typeof resolveConfig = resolveConfig,
): AcpConfigResult {
  let config: ResolvedConfig;
  try {
    config = resolve({
      ...(flags.provider ? { provider: flags.provider } : {}),
      ...(flags.model ? { model: flags.model } : {}),
    });
  } catch (err) {
    // e.g. an unknown provider id in -p; surface the resolver's own message.
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  if (config.needsSetup || !config.provider || !config.model || !config.credentials) {
    return { ok: false, reason: AUTH_GUIDANCE };
  }
  return { ok: true, config };
}

export interface AcpCommandIO {
  err?: (line: string) => void;
  /** Serve loop, injectable for tests. Resolves when the connection ends. */
  serve?: (config: ResolvedConfig) => Promise<void>;
}

/** Serve ACP on this process's stdio until the editor closes the pipe. */
async function serveOnStdio(config: ResolvedConfig): Promise<void> {
  let agent: LuckyAcpAgent | undefined;
  serveAcp(stdioStream(), (conn) => {
    agent = makeAgent(conn, config);
    return agent;
  });
  // The connection lives as long as stdin: when the editor exits or drops the
  // subprocess, stdin ends and we leave. Errors on stdin also end the loop.
  await new Promise<void>((resolve) => {
    process.stdin.once("end", resolve);
    process.stdin.once("close", resolve);
    process.stdin.once("error", resolve);
  });
  // The editor is gone: stop any in-flight turn so the process exits cleanly
  // (the engine records the interruption in each session's transcript).
  agent?.abortAll();
}

function makeAgent(conn: AgentSideConnection, config: ResolvedConfig): LuckyAcpAgent {
  return new LuckyAcpAgent(conn, { config });
}

/** Entry point for `lucky acp [...args]`. Returns the process exit code. */
export async function runAcpCommand(
  args: string[],
  io: AcpCommandIO = {},
): Promise<number> {
  const err = io.err ?? ((line: string) => process.stderr.write(`${line}\n`));

  let flags: { provider?: string; model?: string; help?: boolean };
  try {
    const { values } = parseArgs({
      args,
      options: {
        provider: { type: "string", short: "p" },
        model: { type: "string", short: "m" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: false,
    });
    flags = values;
  } catch (parseErr) {
    err(parseErr instanceof Error ? parseErr.message : String(parseErr));
    err("Usage: lucky acp [-p provider] [-m model]");
    return 1;
  }

  if (flags.help) {
    err("Usage: lucky acp [-p provider] [-m model]");
    err("Serves the Agent Client Protocol on stdio for ACP editors (Zed, JetBrains, ...).");
    err("Configure the editor to spawn this command; log in beforehand by running `lucky`.");
    return 0;
  }

  const resolved = resolveAcpConfig(flags);
  if (!resolved.ok) {
    err(`lucky acp: ${resolved.reason}`);
    return 1;
  }

  err(
    `lucky acp: serving ${resolved.config.provider}/${resolved.config.model} on stdio (protocol on stdout, logs on stderr)`,
  );
  const serve = io.serve ?? serveOnStdio;
  await serve(resolved.config);
  return 0;
}

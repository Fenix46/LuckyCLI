/**
 * SHIM — minimal stand-in for Claude Code's src/utils/env.ts.
 * The vendored Ink fork uses only `env.terminal` (terminal-program detection,
 * for extended-key support and clipboard OSC dispatch). `detectTerminal` is
 * copied verbatim (it's pure — reads only process.env); the rest of the
 * original env object (internet checks, package-manager probes, Anthropic
 * config paths) is omitted.
 */

const JETBRAINS_IDES = [
  "intellij",
  "pycharm",
  "webstorm",
  "phpstorm",
  "rubymine",
  "clion",
  "goland",
  "datagrip",
  "rider",
  "rustrover",
  "appcode",
  "aqua",
  "dataspell",
  "fleet",
];

function isSSHSession(): boolean {
  return Boolean(
    process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY,
  );
}

function detectTerminal(): string | null {
  if (process.env.CURSOR_TRACE_ID) return "cursor";
  if (process.env.VSCODE_GIT_ASKPASS_MAIN?.includes("cursor")) return "cursor";
  if (process.env.VSCODE_GIT_ASKPASS_MAIN?.includes("windsurf")) return "windsurf";
  if (process.env.VSCODE_GIT_ASKPASS_MAIN?.includes("antigravity")) return "antigravity";
  const bundleId = process.env.__CFBundleIdentifier?.toLowerCase();
  if (bundleId?.includes("vscodium")) return "codium";
  if (bundleId?.includes("windsurf")) return "windsurf";
  if (bundleId?.includes("com.google.android.studio")) return "androidstudio";
  if (bundleId) {
    for (const ide of JETBRAINS_IDES) {
      if (bundleId.includes(ide)) return ide;
    }
  }
  if (process.env.VisualStudioVersion) return "visualstudio";
  if (process.env.TERMINAL_EMULATOR === "JetBrains-JediTerm") return "pycharm";
  if (process.env.TERM === "xterm-ghostty") return "ghostty";
  if (process.env.TERM?.includes("kitty")) return "kitty";
  if (process.env.TERM_PROGRAM) return process.env.TERM_PROGRAM;
  if (process.env.TMUX) return "tmux";
  if (process.env.STY) return "screen";
  if (process.env.KONSOLE_VERSION) return "konsole";
  if (process.env.GNOME_TERMINAL_SERVICE) return "gnome-terminal";
  if (process.env.XTERM_VERSION) return "xterm";
  if (process.env.VTE_VERSION) return "vte-based";
  if (process.env.TERMINATOR_UUID) return "terminator";
  if (process.env.KITTY_WINDOW_ID) return "kitty";
  if (process.env.ALACRITTY_LOG) return "alacritty";
  if (process.env.TILIX_ID) return "tilix";
  if (process.env.WT_SESSION) return "windows-terminal";
  if (process.env.SESSIONNAME && process.env.TERM === "cygwin") return "cygwin";
  if (process.env.MSYSTEM) return process.env.MSYSTEM.toLowerCase();
  if (process.env.ConEmuANSI || process.env.ConEmuPID || process.env.ConEmuTask) {
    return "conemu";
  }
  if (process.env.WSL_DISTRO_NAME) return `wsl-${process.env.WSL_DISTRO_NAME}`;
  if (isSSHSession()) return "ssh-session";
  if (process.env.TERM) {
    const term = process.env.TERM;
    if (term.includes("alacritty")) return "alacritty";
    if (term.includes("rxvt")) return "rxvt";
    if (term.includes("termite")) return "termite";
    return term;
  }
  if (!process.stdout.isTTY) return "non-interactive";
  return null;
}

export const env = {
  terminal: detectTerminal(),
};

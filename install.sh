#!/usr/bin/env bash
#
# LuckyCLI installer.
#
#   curl -fsSL https://raw.githubusercontent.com/Fenix46/LuckyCLI/main/install.sh | bash
#
# Downloads the prebuilt `lucky` binary for your platform from the latest
# GitHub release and installs it into ~/.local/bin (override with LUCKY_INSTALL_DIR).
# Pin a version with LUCKY_VERSION=v0.1.0.

set -euo pipefail

REPO="Fenix46/LuckyCLI"
BIN_NAME="lucky"
INSTALL_DIR="${LUCKY_INSTALL_DIR:-$HOME/.local/bin}"
VERSION="${LUCKY_VERSION:-latest}"

# --- pretty output -----------------------------------------------------------
if [ -t 1 ]; then
  BOLD=$'\033[1m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; DIM=$'\033[2m'; RESET=$'\033[0m'
else
  BOLD=""; GREEN=""; YELLOW=""; RED=""; DIM=""; RESET=""
fi

info()  { printf '%s\n' "${DIM}›${RESET} $*"; }
ok()    { printf '%s\n' "${GREEN}✓${RESET} $*"; }
warn()  { printf '%s\n' "${YELLOW}!${RESET} $*" >&2; }
die()   { printf '%s\n' "${RED}✗${RESET} $*" >&2; exit 1; }

# --- detect platform ---------------------------------------------------------
os="$(uname -s)"
arch="$(uname -m)"

case "$os" in
  Darwin) os_name="darwin" ;;
  Linux)  os_name="linux" ;;
  *) die "Unsupported operating system: ${os}. On Windows, download lucky-windows-x64.exe from the releases page." ;;
esac

case "$arch" in
  x86_64|amd64)  arch_name="x64" ;;
  arm64|aarch64) arch_name="arm64" ;;
  *) die "Unsupported architecture: ${arch}" ;;
esac

asset="${BIN_NAME}-${os_name}-${arch_name}"

if [ "$VERSION" = "latest" ]; then
  url="https://github.com/${REPO}/releases/latest/download/${asset}"
else
  url="https://github.com/${REPO}/releases/download/${VERSION}/${asset}"
fi

# --- download ----------------------------------------------------------------
if command -v curl >/dev/null 2>&1; then
  download() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  download() { wget -qO "$2" "$1"; }
else
  die "Need either curl or wget installed to download LuckyCLI."
fi

printf '%s\n' "${BOLD}Installing LuckyCLI${RESET} (${asset}, ${VERSION})"

tmp="$(mktemp -t lucky.XXXXXX)"
trap 'rm -f "$tmp"' EXIT

info "Downloading from ${url}"
download "$url" "$tmp" || die "Download failed. Does a release with asset '${asset}' exist? See https://github.com/${REPO}/releases"
[ -s "$tmp" ] || die "Downloaded file is empty."

# --- install -----------------------------------------------------------------
mkdir -p "$INSTALL_DIR"
target="${INSTALL_DIR}/${BIN_NAME}"
chmod +x "$tmp"
mv "$tmp" "$target"
trap - EXIT
ok "Installed to ${BOLD}${target}${RESET}"

# --- PATH --------------------------------------------------------------------
case ":${PATH}:" in
  *":${INSTALL_DIR}:"*)
    : # already on PATH
    ;;
  *)
    line="export PATH=\"${INSTALL_DIR}:\$PATH\""
    rc=""
    case "$(basename "${SHELL:-}")" in
      zsh)  rc="$HOME/.zshrc" ;;
      bash) [ -f "$HOME/.bashrc" ] && rc="$HOME/.bashrc" || rc="$HOME/.bash_profile" ;;
    esac
    if [ -n "$rc" ]; then
      if [ -f "$rc" ] && grep -qF "$INSTALL_DIR" "$rc" 2>/dev/null; then
        : # an entry already references the dir
      else
        printf '\n# Added by the LuckyCLI installer\n%s\n' "$line" >> "$rc"
        ok "Added ${INSTALL_DIR} to your PATH in ${rc}"
        warn "Run ${BOLD}source ${rc}${RESET} or open a new terminal to use 'lucky'."
      fi
    else
      warn "Add ${INSTALL_DIR} to your PATH manually:"
      printf '    %s\n' "$line" >&2
    fi
    ;;
esac

printf '\n'
ok "Done. Start it with: ${BOLD}${BIN_NAME}${RESET}"

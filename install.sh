#!/usr/bin/env bash
set -e

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  ⚓ ANCHOR-LAB-AI INSTALLER                                  ║"
echo "╚══════════════════════════════════════════════════════════════╝"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${HOME}/.anchor-lab-ai"
BIN_DIR="${HOME}/.local/bin"
CLAUDE_SKILLS_DIR="${HOME}/.claude/skills/anchor-lab-ai"

# Helper: Check and auto-install tmux (Arch Linux, Ubuntu/Debian, Fedora, macOS)
ensure_tmux() {
  if command -v tmux >/dev/null 2>&1; then
    echo "✔ tmux detected: $(tmux -V)"
    return 0
  fi

  echo "⚠ tmux is required for background workers and research council sessions."
  echo "Attempting automatic installation..."

  local INSTALL_CMD=""
  local PKG_MANAGER=""

  if command -v pacman >/dev/null 2>&1; then
    PKG_MANAGER="pacman (Arch Linux)"
    INSTALL_CMD="pacman -S --noconfirm tmux"
  elif command -v apt-get >/dev/null 2>&1; then
    PKG_MANAGER="apt (Ubuntu/Debian)"
    INSTALL_CMD="apt-get update -qq && apt-get install -y tmux"
  elif command -v dnf >/dev/null 2>&1; then
    PKG_MANAGER="dnf (Fedora/RHEL)"
    INSTALL_CMD="dnf install -y tmux"
  elif command -v zypper >/dev/null 2>&1; then
    PKG_MANAGER="zypper (openSUSE)"
    INSTALL_CMD="zypper install -y tmux"
  elif command -v apk >/dev/null 2>&1; then
    PKG_MANAGER="apk (Alpine)"
    INSTALL_CMD="apk add tmux"
  elif command -v brew >/dev/null 2>&1; then
    PKG_MANAGER="brew (Homebrew)"
    INSTALL_CMD="brew install tmux"
  fi

  if [ -z "$INSTALL_CMD" ]; then
    echo "✖ Unsupported package manager. Please install tmux manually (e.g. 'sudo pacman -S tmux' or 'sudo apt install tmux')." >&2
    return 1
  fi

  echo "Detected package manager: ${PKG_MANAGER}"

  if [ "$(id -u)" -eq 0 ]; then
    eval "$INSTALL_CMD"
  else
    if command -v sudo >/dev/null 2>&1; then
      echo "Requesting sudo permissions to install tmux..."
      eval "sudo $INSTALL_CMD"
    else
      echo "✖ 'sudo' not available. Please run: '$INSTALL_CMD' as root." >&2
      return 1
    fi
  fi

  if command -v tmux >/dev/null 2>&1; then
    echo "✔ Successfully installed tmux: $(tmux -V)"
  else
    echo "✖ Failed to verify tmux installation. Please install tmux manually." >&2
    return 1
  fi
}

# 1. Dependency Checks
echo "[1/5] Checking dependencies..."
command -v node >/dev/null 2>&1 || { echo "✖ Node.js is required but not installed. Aborting." >&2; exit 1; }
ensure_tmux

# 2. Setup runtime directory
echo "[2/5] Preparing runtime directory at ${TARGET_DIR}..."
mkdir -p "${TARGET_DIR}/bin"
mkdir -p "${TARGET_DIR}/server"
mkdir -p "${TARGET_DIR}/daemon"
mkdir -p "${TARGET_DIR}/projects"

cp -r "${ROOT_DIR}/bin/"* "${TARGET_DIR}/bin/"
cp -r "${ROOT_DIR}/server/"* "${TARGET_DIR}/server/"
cp -r "${ROOT_DIR}/daemon/"* "${TARGET_DIR}/daemon/"
chmod +x "${TARGET_DIR}/bin/anchor-lab-ai"

# 3. Symlink global executable
echo "[3/5] Symlinking CLI executable..."
mkdir -p "${BIN_DIR}"
ln -sf "${TARGET_DIR}/bin/anchor-lab-ai" "${BIN_DIR}/anchor-lab-ai"

# 4. Link Claude Code Plugin
echo "[4/5] Registering Claude Code Plugin..."
mkdir -p "$(dirname "${CLAUDE_SKILLS_DIR}")"
ln -sfn "${ROOT_DIR}/claude-plugin" "${CLAUDE_SKILLS_DIR}"

# 5. Verify installation
echo "[5/5] Verifying installation..."
"${BIN_DIR}/anchor-lab-ai" doctor

echo ""
echo "✔ Anchor-Lab-Ai installed successfully!"
echo "• CLI: Run 'anchor-lab-ai doctor' or 'anchor-lab-ai help'"
echo "• Claude Code: Slash commands available (/anchor, /anchorgraph, /anchorscan, etc.)"

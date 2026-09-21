#!/usr/bin/env bash
set -e

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  ⚓ ANCHOR-LAB-AI INSTALLER                                  ║"
echo "╚══════════════════════════════════════════════════════════════╝"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${HOME}/.anchor-lab-ai"
BIN_DIR="${HOME}/.local/bin"
CLAUDE_SKILLS_DIR="${HOME}/.claude/skills/anchor-lab-ai"

# 1. Dependency Checks
echo "[1/5] Checking dependencies..."
command -v node >/dev/null 2>&1 || { echo "✖ Node.js is required but not installed. Aborting." >&2; exit 1; }
command -v tmux >/dev/null 2>&1 || { echo "⚠ tmux is not installed. Background daemon requires tmux (run: sudo apt install tmux)." >&2; }

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

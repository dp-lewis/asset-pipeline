#!/usr/bin/env bash
# Links the game-asset skill into Claude Code's personal skills folder,
# so it's available in every project and stays up to date with this repo.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/skills/game-asset"
DEST_DIR="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
DEST="$DEST_DIR/game-asset"

mkdir -p "$DEST_DIR"
if [ -e "$DEST" ] && [ ! -L "$DEST" ]; then
  echo "$DEST already exists and isn't a link — move it aside first." >&2
  exit 1
fi
ln -sfn "$SRC" "$DEST"
echo "Linked $DEST -> $SRC"
echo "Restart Claude Code to pick up the skill."

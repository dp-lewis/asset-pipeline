#!/usr/bin/env bash
# Runs the whole pipeline with fake providers (no API calls, no cost).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$ROOT/.smoke"
CLI="node $ROOT/dist/cli.js"

rm -rf "$WORK" && mkdir -p "$WORK" && cd "$WORK"
export ASSET_PIPELINE_MOCK=1

$CLI init --game "Smoke Test"
cp "$ROOT/test/fixtures/reference.png" art/concept/01-hillside.png
$CLI refs
$CLI new stone-wall "mossy dry-stone wall section, about 2m long"
$CLI concept stone-wall
$CLI concept stone-wall --revise r1-2 --feedback "less moss, flatter top"
$CLI approve stone-wall r2-1
$CLI turnaround stone-wall
$CLI turnaround stone-wall --view left --note "show the end stones"
$CLI approve stone-wall
$CLI model stone-wall            # should stop and ask for --yes
$CLI estimate stone-wall --face-limit 8000
$CLI model stone-wall --yes --face-limit 8000
$CLI status
$CLI status stone-wall
test -f art/models/stone-wall.fbx
echo "Smoke test passed."

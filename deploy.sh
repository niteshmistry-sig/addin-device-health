#!/usr/bin/env bash
set -euo pipefail

# Deploy Device Health Diagnostics add-in
# Usage: ./deploy.sh [--profile <profile>] [--sync-config]
#
# Steps:
#   1. Build docs/index.html (inlined CSS+JS) and docs/config.json
#   2. Git commit & push to GitHub (auto-deploys to GitHub Pages)
#   3. (Optional) Sync config to MyGeotab when --sync-config is passed
#
# Code changes (HTML/CSS/JS) auto-deploy via GitHub Pages — no MyGeotab update needed.
# Config changes (path, menu name, icon) need --sync-config to update MyGeotab.

ROOT="$(cd "$(dirname "$0")" && pwd)"
MYG_CLI="/Users/niteshmistry/.claude/skills/cli-mygeotab/bin/cli-mygeotab-darwin-arm64"
ADDIN_NAME="Device Health Diagnostics"

# Parse args
PROFILE="fmc_demo"
DATABASE="fmc_demo"
SYNC_CONFIG=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --profile)      PROFILE="$2"; shift 2 ;;
        --database)     DATABASE="$2"; shift 2 ;;
        --sync-config)  SYNC_CONFIG=true; shift ;;
        *)              echo "Unknown arg: $1"; exit 1 ;;
    esac
done

echo "=== Step 1: Build ==="
python3 /tmp/build_dhd.py

echo ""
echo "=== Step 2: Git push ==="
cd "$ROOT"
if git diff --quiet docs/ config.json 2>/dev/null; then
    echo "No changes to commit."
else
    git add docs/ config.json
    git commit -m "Deploy: update add-in build"
    git push
    echo "Pushed to GitHub. Waiting 20s for GitHub Pages..."
    sleep 20
fi

echo ""
echo "=== Step 3: Config sync check ==="
if [[ "$SYNC_CONFIG" == "true" ]]; then
    python3 "$ROOT/scripts/myg_sync_config.py" --profile "$PROFILE" --database "$DATABASE"
else
    # Just check if config is in sync
    python3 "$ROOT/scripts/myg_sync_config.py" --profile "$PROFILE" --database "$DATABASE" --dry-run
fi

echo ""
echo "Done! GitHub Pages will serve the latest build."
echo "URL: https://niteshmistry-sig.github.io/addin-device-health/index.html"

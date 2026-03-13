#!/usr/bin/env bash
set -euo pipefail

# Deploy Device Health Diagnostics add-in
# Usage: ./deploy.sh [--database <db>] [--profile <profile>]
#
# Steps:
#   1. Build docs/index.html (inlined CSS+JS) and docs/config.json
#   2. Git commit & push to GitHub (auto-deploys to GitHub Pages)
#   3. Deploy add-in to MyGeotab via cli-mygeotab addin deploy
#
# The config.json served on GitHub Pages is the single source of truth.
# Any changes to config.json (path, menu name, icon, URL) are automatically
# applied to MyGeotab without manual admin panel edits.

ROOT="$(cd "$(dirname "$0")" && pwd)"
CONFIG_URL="https://niteshmistry-sig.github.io/addin-device-health/config.json"
MYG_CLI="/Users/niteshmistry/.claude/skills/cli-mygeotab/bin/cli-mygeotab-darwin-arm64"

# Parse args
DATABASE=""
PROFILE=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --database) DATABASE="$2"; shift 2 ;;
        --profile)  PROFILE="$2"; shift 2 ;;
        *)          echo "Unknown arg: $1"; exit 1 ;;
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
echo "=== Step 3: Deploy to MyGeotab ==="
DEPLOY_ARGS=(addin deploy --url "$CONFIG_URL" --replace)
if [[ -n "$PROFILE" ]]; then
    DEPLOY_ARGS+=(--profile "$PROFILE")
fi
"$MYG_CLI" "${DEPLOY_ARGS[@]}"

echo ""
echo "Done! Add-in deployed to MyGeotab."
echo "Config URL: $CONFIG_URL"

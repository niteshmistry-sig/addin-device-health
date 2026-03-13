#!/usr/bin/env bash
set -euo pipefail

# Deploy Device Health Diagnostics add-in
# Usage: ./deploy.sh [--profile <profile>] [--sync-config]
#
# Steps:
#   1. Build docs/index.html (inlined CSS+JS) and docs/config.json
#   2. Git commit & push to GitHub (auto-deploys to GitHub Pages)
#   3. (Optional) Sync config changes to MyGeotab when --sync-config is passed
#
# Code changes (HTML/CSS/JS) auto-deploy via GitHub Pages — no MyGeotab update needed.
# Config changes (path, menu name, icon) need --sync-config to update MyGeotab.

ROOT="$(cd "$(dirname "$0")" && pwd)"
MYG_CLI="/Users/niteshmistry/.claude/skills/cli-mygeotab/bin/cli-mygeotab-darwin-arm64"
ADDIN_NAME="Device Health Diagnostics"

# Parse args
PROFILE="fmc_demo"
SYNC_CONFIG=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --profile)      PROFILE="$2"; shift 2 ;;
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
echo "=== Step 3: Check config sync ==="
# Compare local config.json with what's deployed in MyGeotab
CURRENT=$("$MYG_CLI" addin list --profile "$PROFILE" --output json --quiet 2>/dev/null || echo "[]")
DEPLOYED_CONFIG=$(echo "$CURRENT" | python3 -c "
import json, sys
addins = json.load(sys.stdin)
for a in addins:
    if a.get('configuration',{}).get('name','') == '$ADDIN_NAME':
        print(json.dumps(a['configuration']))
        sys.exit(0)
print('')
" 2>/dev/null)

if [[ -z "$DEPLOYED_CONFIG" ]]; then
    echo "Add-in '$ADDIN_NAME' not found in MyGeotab (profile: $PROFILE)."
    echo "To install it, use the MyGeotab admin panel:"
    echo "  Administration > System Settings > Add-Ins > New Add-In"
    echo "  Paste the contents of config.json"
    SYNC_CONFIG=true
fi

# Check if config matches
LOCAL_CONFIG=$(cat "$ROOT/config.json")
CONFIG_MATCHES=$(python3 -c "
import json, sys
local = json.loads('''$LOCAL_CONFIG''')
deployed_str = '''$DEPLOYED_CONFIG'''
if not deployed_str:
    print('no')
    sys.exit(0)
deployed = json.loads(deployed_str)
# Compare relevant fields
local_items = local.get('items', [])
deployed_items = deployed.get('items', [])
if len(local_items) != len(deployed_items):
    print('no')
    sys.exit(0)
for l, d in zip(local_items, deployed_items):
    if l.get('path','') != d.get('path','') or l.get('url','') != d.get('url','') or l.get('menuName',{}) != d.get('menuName',{}):
        print('no')
        sys.exit(0)
print('yes')
" 2>/dev/null || echo "no")

if [[ "$CONFIG_MATCHES" == "yes" ]]; then
    echo "Config is in sync with MyGeotab. No admin changes needed."
elif [[ "$SYNC_CONFIG" == "true" ]]; then
    echo ""
    echo "=== Syncing config to MyGeotab ==="
    # Remove old add-in
    OLD_ID=$(echo "$CURRENT" | python3 -c "
import json, sys
addins = json.load(sys.stdin)
for a in addins:
    if a.get('configuration',{}).get('name','') == '$ADDIN_NAME':
        print(a['id'])
        sys.exit(0)
print('')
" 2>/dev/null)

    if [[ -n "$OLD_ID" ]]; then
        echo "Removing old add-in (ID: $OLD_ID)..."
        "$MYG_CLI" addin remove --id "$OLD_ID" --profile "$PROFILE"
    fi

    # Re-install by adding config to customerPages via system settings
    echo "Installing updated config..."
    python3 "$ROOT/scripts/myg_sync_config.py" --profile "$PROFILE"
    echo "Config synced to MyGeotab."
else
    echo ""
    echo "WARNING: Config has changed but MyGeotab was not updated."
    echo "  Local path:  $(python3 -c "import json; print(json.load(open('$ROOT/config.json')).get('items',[{}])[0].get('path',''))")"
    echo "  Deployed:    $(echo "$DEPLOYED_CONFIG" | python3 -c "import json,sys; d=json.loads(sys.stdin.read() or '{}'); print(d.get('items',[{}])[0].get('path','(not deployed)'))" 2>/dev/null)"
    echo ""
    echo "  Run with --sync-config to update MyGeotab."
fi

echo ""
echo "Done! GitHub Pages will serve the latest build."
echo "URL: https://niteshmistry-sig.github.io/addin-device-health/index.html"

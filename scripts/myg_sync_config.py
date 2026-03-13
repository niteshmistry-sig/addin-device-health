#!/usr/bin/env python3
"""Sync config.json to MyGeotab by removing the old add-in and re-adding
it via browser automation (cli-chrome) on the System Settings page.

Uses cli-mygeotab to detect changes and remove old entries.
Uses cli-chrome to add the new entry via the admin panel UI.

Usage:
    python3 scripts/myg_sync_config.py --profile fmc_demo
"""
import argparse
import base64
import json
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MYG_CLI = "/Users/niteshmistry/.claude/skills/cli-mygeotab/bin/cli-mygeotab-darwin-arm64"
ADDIN_NAME = "Device Health Diagnostics"


def resolve_chrome_cli():
    """Resolve the cli-chrome binary path."""
    script = "/Users/niteshmistry/.claude/skills/cli-chrome/scripts/resolve_cli.sh"
    result = subprocess.run([script], capture_output=True, text=True)
    return result.stdout.strip()


def run_cli(*args):
    """Run cli-mygeotab and return stdout."""
    cmd = [MYG_CLI] + list(args)
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"CLI error: {result.stderr.strip()}", file=sys.stderr)
        sys.exit(1)
    return result.stdout


def run_chrome(ndjson_cmd):
    """Send an NDJSON command to cli-chrome and return parsed result."""
    cli = resolve_chrome_cli()
    result = subprocess.run(
        [cli], input=json.dumps(ndjson_cmd), capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"Chrome CLI error: {result.stderr.strip()}", file=sys.stderr)
        return None
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return None


def get_addin_list(profile):
    """Get list of installed add-ins via CLI."""
    out = run_cli("addin", "list", "--profile", profile, "--output", "json", "--quiet")
    return json.loads(out)


def remove_addin(profile, addin_id):
    """Remove an add-in by ID."""
    run_cli("addin", "remove", "--id", addin_id, "--profile", profile)
    print(f"  Removed add-in {addin_id}")


def install_via_browser(config_json, database="fmc_demo"):
    """Install add-in config via browser automation on System Settings page."""
    cli = resolve_chrome_cli()

    # 1. Check browser bridge
    result = subprocess.run([cli, "bridge", "preflight"], capture_output=True, text=True)
    if result.returncode != 0:
        print("ERROR: Chrome bridge not available. Cannot automate admin panel.", file=sys.stderr)
        print("Run the installation manually (see instructions below).", file=sys.stderr)
        return False

    # 2. Open System Settings Add-Ins page
    print("  Opening System Settings...")
    resp = run_chrome({
        "id": "open",
        "method": "tab.open",
        "params": {"url": f"https://my.geotab.com/{database}/#systemSettings"}
    })
    if not resp or "result" not in resp:
        print("ERROR: Could not open System Settings page.", file=sys.stderr)
        return False
    tab_id = resp["result"]["tabId"]
    time.sleep(4)

    # 3. Click Add-Ins tab
    print("  Navigating to Add-Ins tab...")
    run_chrome({
        "id": "click-addins",
        "method": "tab.act",
        "params": {
            "tabId": tab_id,
            "actions": [
                {"type": "click", "selector": "#addIns"},
                {"type": "wait", "readyState": "complete"}
            ]
        }
    })
    time.sleep(1)

    # 4. Click "+ Add-In" button
    print("  Opening new Add-In dialog...")
    run_chrome({
        "id": "new-addin",
        "method": "tab.act",
        "params": {
            "tabId": tab_id,
            "actions": [{"type": "click", "selector": 'button[aria-label="Add-In"]'}]
        }
    })
    time.sleep(1)

    # 5. Set textarea content via base64 (avoids escaping issues)
    config_pretty = json.dumps(config_json, indent=4)
    config_b64 = base64.b64encode(config_pretty.encode()).decode()

    print("  Setting configuration...")
    js_expr = (
        f"var ta=document.querySelector('textarea');"
        f"var setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;"
        f"setter.call(ta,atob('{config_b64}'));"
        f"ta.dispatchEvent(new Event('input',{{bubbles:true}}));"
        f"ta.dispatchEvent(new Event('change',{{bubbles:true}}));"
        f"ta.value.length"
    )
    resp = run_chrome({
        "id": "set-config",
        "method": "tab.eval",
        "params": {"tabId": tab_id, "expression": js_expr}
    })
    if not resp or resp.get("result", {}).get("value", 0) == 0:
        print("ERROR: Could not set textarea content.", file=sys.stderr)
        run_chrome({"id": "close", "method": "tab.close", "params": {"tabId": tab_id}})
        return False

    # 6. Click Done
    print("  Clicking Done...")
    run_chrome({
        "id": "done",
        "method": "tab.act",
        "params": {
            "tabId": tab_id,
            "actions": [{"type": "click", "role": "button", "name": "Done"}]
        }
    })
    time.sleep(1)

    # 7. Click Save
    print("  Saving system settings...")
    run_chrome({
        "id": "save",
        "method": "tab.act",
        "params": {
            "tabId": tab_id,
            "actions": [{"type": "click", "selector": "#systemSettings_saveChangesButton"}]
        }
    })
    time.sleep(5)

    # 8. Close the tab
    run_chrome({"id": "close", "method": "tab.close", "params": {"tabId": tab_id}})
    print("  Done.")
    return True


def print_manual_instructions(config_json):
    """Print manual installation instructions as fallback."""
    print("\n" + "=" * 60)
    print("MANUAL STEP REQUIRED")
    print("=" * 60)
    print()
    print("To complete the config sync, paste this JSON into MyGeotab:")
    print()
    print("  1. Go to Administration > System Settings > Add-Ins")
    print("  2. Click '+ Add-In'")
    print("  3. Paste the following JSON into the Configuration textarea:")
    print()
    print(json.dumps(config_json, indent=2))
    print()
    print("  4. Click 'Done', then 'Save'")
    print()


def main():
    parser = argparse.ArgumentParser(description="Sync config.json to MyGeotab")
    parser.add_argument("--profile", default="fmc_demo", help="CLI profile to use")
    parser.add_argument("--database", default="fmc_demo", help="MyGeotab database name")
    parser.add_argument("--dry-run", action="store_true", help="Show what would change")
    parser.add_argument("--manual", action="store_true", help="Print manual instructions instead of browser automation")
    args = parser.parse_args()

    # Load local config
    config_path = os.path.join(ROOT, "config.json")
    with open(config_path) as f:
        local_config = json.load(f)
    print(f"Local config: {local_config['name']} v{local_config['version']}")
    print(f"  Path: {local_config['items'][0]['path']}")
    print(f"  URL:  {local_config['items'][0]['url']}")

    # Get current add-ins
    addins = get_addin_list(args.profile)
    existing = None
    for a in addins:
        cfg = a.get("configuration", {})
        if cfg.get("name") == ADDIN_NAME:
            existing = a
            break

    if existing:
        deployed_cfg = existing["configuration"]
        deployed_item = deployed_cfg.get("items", [{}])[0]
        local_item = local_config["items"][0]

        # Check if config matches
        changes = []
        if deployed_item.get("path", "") != local_item.get("path", ""):
            changes.append(f"  path: {deployed_item.get('path','')} -> {local_item['path']}")
        if deployed_item.get("url", "") != local_item.get("url", ""):
            changes.append(f"  url: {deployed_item.get('url','')} -> {local_item['url']}")
        if deployed_item.get("menuName", {}) != local_item.get("menuName", {}):
            changes.append(f"  menuName: {deployed_item.get('menuName',{})} -> {local_item['menuName']}")
        if deployed_item.get("svgIcon", "") != local_item.get("svgIcon", ""):
            changes.append(f"  svgIcon: changed")

        if not changes:
            print("\nConfig already in sync. No changes needed.")
            return

        print(f"\nChanges detected:")
        for c in changes:
            print(c)

        if args.dry_run:
            print("\n(dry run — no changes applied)")
            return

        # Remove old add-in
        print(f"\nRemoving old add-in (ID: {existing['id']})...")
        remove_addin(args.profile, existing["id"])
    else:
        if args.dry_run:
            print("\nAdd-in not found. Would install fresh.")
            print("(dry run — no changes applied)")
            return
        print("\nAdd-in not found. Installing fresh.")

    # Install new config
    if args.manual:
        print_manual_instructions(local_config)
    else:
        print("\nInstalling via browser automation...")
        success = install_via_browser(local_config, database=args.database)
        if not success:
            print_manual_instructions(local_config)
            sys.exit(1)

    # Verify installation
    print("\nVerifying installation...")
    addins = get_addin_list(args.profile)
    found = False
    for a in addins:
        if a.get("configuration", {}).get("name") == ADDIN_NAME:
            item = a["configuration"]["items"][0]
            print(f"  Installed: {ADDIN_NAME}")
            print(f"  Path: {item.get('path','')}")
            print(f"  URL:  {item.get('url','')}")
            found = True
            break
    if not found:
        print("  WARNING: Add-in not found after installation.")
        print("  The save may still be processing. Check MyGeotab manually.")


if __name__ == "__main__":
    main()

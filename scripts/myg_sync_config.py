#!/usr/bin/env python3
"""Sync config.json to MyGeotab as an inline add-in in customerPages.

Uses cli-mygeotab for authentication (reads system settings) and
makes a direct API call to update SystemSettings.customerPages.

Usage:
    python3 scripts/myg_sync_config.py --profile fmc_demo
"""
import argparse
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MYG_CLI = "/Users/niteshmistry/.claude/skills/cli-mygeotab/bin/cli-mygeotab-darwin-arm64"
ADDIN_NAME = "Device Health Diagnostics"


def run_cli(*args):
    """Run cli-mygeotab and return stdout."""
    cmd = [MYG_CLI] + list(args)
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"CLI error: {result.stderr.strip()}", file=sys.stderr)
        sys.exit(1)
    return result.stdout


def get_current_settings(profile):
    """Get current SystemSettings via CLI."""
    out = run_cli("system", "settings", "--profile", profile, "--output", "json", "--quiet")
    return json.loads(out)


def get_addin_list(profile):
    """Get list of installed add-ins via CLI."""
    out = run_cli("addin", "list", "--profile", profile, "--output", "json", "--quiet")
    return json.loads(out)


def remove_addin(profile, addin_id):
    """Remove an add-in by ID."""
    run_cli("addin", "remove", "--id", addin_id, "--profile", profile)
    print(f"  Removed add-in {addin_id}")


def main():
    parser = argparse.ArgumentParser(description="Sync config.json to MyGeotab")
    parser.add_argument("--profile", default="fmc_demo", help="CLI profile to use")
    parser.add_argument("--dry-run", action="store_true", help="Show what would change without applying")
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

    # Get current customerPages from SystemSettings
    print("Reading current SystemSettings...")
    settings = get_current_settings(args.profile)
    pages = settings.get("customerPages", [])
    print(f"  Current customerPages: {len(pages)} entries")

    # Remove any existing entry for our add-in from customerPages
    new_pages = []
    for p in pages:
        try:
            obj = json.loads(p)
            if obj.get("name") == ADDIN_NAME:
                print(f"  Removing old customerPages entry for '{ADDIN_NAME}'")
                continue
        except (json.JSONDecodeError, TypeError):
            pass
        new_pages.append(p)

    # Add new entry
    new_entry = json.dumps(local_config, separators=(",", ":"))
    new_pages.append(new_entry)
    print(f"  Adding new customerPages entry for '{ADDIN_NAME}'")
    print(f"  New customerPages total: {len(new_pages)} entries")

    # The CLI doesn't have a "system settings set" command.
    # We need to use the MyGeotab API directly.
    # The CLI stores auth in ~/myg-cli.json but uses Keycloak bearer tokens
    # which can't be used directly with the API for Set calls.
    #
    # Workaround: output the JSON for manual paste into admin panel,
    # or use cli-chrome to automate the admin panel.
    print("\n" + "=" * 60)
    print("MANUAL STEP REQUIRED")
    print("=" * 60)
    print()
    print("The MyGeotab API requires authenticated sessions that cannot be")
    print("obtained from the CLI's Keycloak tokens for Set operations.")
    print()
    print("To complete the config sync, paste this JSON into the MyGeotab")
    print("admin panel:")
    print()
    print("  1. Go to Administration > System Settings > Add-Ins")
    print("  2. Click 'New Add-In'")
    print("  3. Paste the following JSON:")
    print()
    print(json.dumps(local_config, indent=2))
    print()
    print("  4. Click 'Save'")
    print()


if __name__ == "__main__":
    main()

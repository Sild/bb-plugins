#!/usr/bin/env python3
"""Enable the repository's once-a-minute BB source sync automation."""
import argparse
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
NAME = "Sync active BB plugins to repository"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, help="BB project ID owning this checkout")
    args = parser.parse_args()
    # Initialize merge baselines before the automation can touch any source files.
    subprocess.run([sys.executable, str(ROOT / "scripts/sync_plugins.py")], check=True)
    automations = json.loads(subprocess.check_output(
        ["bb", "automation", "list", "--project", args.project, "--json"], text=True))
    matches = [a for a in automations if a["name"] == NAME]
    if len(matches) > 1:
        raise ValueError("Multiple matching sync automations; choose one in BB before retrying")
    command = ["bb", "automation", "update", matches[0]["id"]] if matches else ["bb", "automation", "create"]
    command += ["--project", args.project, "--name", NAME, "--cron", "* * * * *", "--timezone", "UTC",
                "--script-file", str(ROOT / "scripts/sync_plugins.sh"), "--interpreter", "sh",
                "--working-directory", str(ROOT), "--timeout", "90s"]
    subprocess.run(command, check=True)
    if matches:
        subprocess.run(["bb", "automation", "resume", matches[0]["id"], "--project", args.project], check=True)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)

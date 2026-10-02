#!/usr/bin/env python3
"""Install this collection and restore its portable BB preset using the public CLI."""
import argparse
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def run(args, capture=False, cwd=None):
    result = subprocess.run(args, cwd=cwd, check=True, text=True,
                            stdout=subprocess.PIPE if capture else None)
    return json.loads(result.stdout) if capture else None


def bb_json(*args):
    return run(["bb", *args, "--json"], capture=True)


def value(v):
    return json.dumps(v, ensure_ascii=False) if not isinstance(v, str) else v


def rpc(method, data=None):
    with tempfile.TemporaryDirectory(prefix="bb-preset-rpc-") as directory:
        path = Path(directory) / "input.json"
        path.write_text(json.dumps(data))
        return bb_json("plugin", "rpc", "call", "project-groups", method,
                       "--input-file", str(path))


def commands(preset, entries, yes, installed_ids=None):
    installed_ids = installed_ids or set()
    for plugin in preset["plugins"]:
        if plugin["source"].startswith("builtin:") and plugin["id"] not in installed_ids:
            yield ["bb", "plugin", "install", plugin["source"], *(["--yes"] if yes else [])], None
    for plugin in preset["plugins"]:
        if plugin["source"].startswith("collection:"):
            directory = ROOT / entries[plugin["id"]][2:]
            yield ["npm", "ci", "--omit=dev", "--omit=optional", "--no-audit", "--no-fund"], directory
            yield ["bb", "plugin", "install", "path:" + str(ROOT), "--plugin", plugin["id"], *(["--yes"] if yes else [])], None
    # Built-in plugin code ships with the app; only restore its enabled state.
    for plugin in preset["plugins"]:
        yield ["bb", "plugin", "enable" if plugin["enabled"] else "disable", plugin["id"]], None
    for plugin, settings in preset["pluginSettings"].items():
        for key, v in settings.items():
            yield ["bb", "plugin", "config", plugin, "set", key, value(v)], None
    for key, v in preset["general"].items():
        yield ["bb", "settings", "general", key, value(v)], None
    for provider, display in preset["completedTurns"].items():
        yield ["bb", "settings", "completed-turns", provider, display], None
    for key, v in preset["experiments"].items():
        yield ["bb", "settings", "experiment", key, value(v)], None
    for key, v in preset["ui"].items():
        yield ["bb", "settings", "ui", "set", key, value(v)], None
    for override in preset["keyboardOverrides"]:
        shortcut = override["shortcut"]
        text = "disabled" if shortcut is None else "+".join(
            [name for key, name in [("mod", "Mod"), ("meta", "Meta"), ("control", "Ctrl"), ("alt", "Alt"), ("shift", "Shift")] if shortcut.get(key)] + [shortcut["key"]])
        yield ["bb", "settings", "keyboard", "set", override["command"], text], None
    for task, selection in preset["aiServices"].items():
        yield ["bb", "settings", "ai-services", "set", task, selection["mode"]], None
    yield ["bb", "theme", "set", preset["appearance"]["themeId"]], None
    yield ["bb", "theme", "favicon", "set", preset["appearance"]["faviconColor"]], None


def restore_groups(preset):
    state = rpc("groups_list")
    for group in preset["projectGroups"]:
        matches = [g for g in state["groups"] if g["name"] == group["name"]]
        if len(matches) > 1:
            raise ValueError("Ambiguous project group: " + group["name"])
        state = rpc("groups_update", {"id": matches[0]["id"], **group}) if matches else rpc("groups_create", group)
    groups = {g["name"]: g["id"] for g in state["groups"]}
    projects = bb_json("project", "list")
    def project_id(name):
        matches = [p["id"] for p in projects if p["name"] == name]
        if len(matches) != 1:
            print("Skipped project mapping (missing or ambiguous name): " + name)
            return None
        return matches[0]
    for assignment in preset["projectAssignments"]:
        project = project_id(assignment["projectName"])
        if project:
            rpc("groups_assign", {"projectId": project, "groupId": groups[assignment["groupName"]]})
    for name in preset["pinnedProjects"]:
        project = project_id(name)
        if project:
            rpc("groups_pin_project", {"projectId": project, "pinned": True})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Change the running BB instance; default is a command preview")
    parser.add_argument("--yes", action="store_true", help="Trust these five local plugin sources without individual install prompts")
    args = parser.parse_args()
    preset = json.loads((ROOT / "preset/settings.json").read_text())
    collection = json.loads((ROOT / ".bb/plugins.json").read_text())
    if preset["schemaVersion"] != 1 or collection["schemaVersion"] != 1:
        raise ValueError("Unsupported preset/collection schema version")
    entries = {p["name"]: p["source"] for p in collection["plugins"]}
    planned = list(commands(preset, entries, args.yes))
    if not args.apply:
        for command, cwd in planned:
            condition = "(if missing) " if command[:3] == ["bb", "plugin", "install"] and command[3].startswith("builtin:") else ""
            print(condition + ("(in " + str(cwd) + ") " if cwd else "") + shlex.join(command))
        print("Then restore project groups and assign/pin uniquely named existing projects. No changes made.")
        return
    for executable in ["bb", "node", "npm"]:
        if not shutil.which(executable):
            raise ValueError("Required executable not found: " + executable)
    version = subprocess.check_output(["bb", "--version"], text=True).strip()
    if tuple(int(n) for n in version.split("-")[0].split(".")[:2]) < (0, 44):
        raise ValueError("BB 0.44.0 or newer is required")
    installed = bb_json("plugin", "list")["plugins"]
    installed_ids = {p["id"] for p in installed}
    planned = list(commands(preset, entries, args.yes, installed_ids))
    backup = {"plugins": [{k: p[k] for k in ["id", "source", "enabled"]} for p in installed],
              "settings": bb_json("settings", "show"), "ui": bb_json("settings", "ui", "list"),
              "aiServices": bb_json("settings", "ai-services", "show"), "pluginSettings": {}}
    for plugin in preset["pluginSettings"]:
        if plugin in installed_ids:
            config = bb_json("plugin", "config", plugin)
            backup["pluginSettings"][plugin] = {k: v for k, v in config.get("values", {}).items()
                                               if not config.get("schema", {}).get(k, {}).get("secret")}
    if "project-groups" in installed_ids:
        backup["projectGroups"] = rpc("groups_list")
    fd, path = tempfile.mkstemp(prefix="bb-before-preset-", suffix=".json")
    with os.fdopen(fd, "w") as file:
        json.dump(backup, file, indent=2)
    print("Previous settings saved to " + path, flush=True)
    print("Target: " + os.environ.get("BB_SERVER_URL", "http://127.0.0.1:38886"), flush=True)
    for command, cwd in planned:
        run(command, cwd=cwd)
    restore_groups(preset)
    print("Preset restored. Sign in to providers separately; re-run after adding projects to restore their folder assignments.")


if __name__ == "__main__":
    try:
        main()
    except (subprocess.CalledProcessError, ValueError, KeyError, OSError) as error:
        print("Restore stopped: " + str(error), file=sys.stderr)
        sys.exit(1)

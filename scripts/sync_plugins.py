#!/usr/bin/env python3
"""Capture running local BB plugin sources without overwriting concurrent repo edits."""
import argparse
import base64
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SKIP_DIRS = {".git", ".bb", "node_modules", "dist", "host-data", "__pycache__", "coverage", "logs"}
EXTENSIONS = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".yaml", ".yml", ".css", ".html", ".svg", ".png", ".webp", ".jpg", ".jpeg", ".sh"}


def encode(data):
    return None if data is None else base64.b64encode(data).decode("ascii")


def decode(data):
    return None if data is None else base64.b64decode(data)


def snapshot(directory):
    result = {}
    for parent, dirs, files in os.walk(directory, followlinks=False):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and not (Path(parent) / d).is_symlink())
        for name in sorted(files):
            path = Path(parent) / name
            if path.is_symlink() or name.startswith(".env") or re.search(r"secret|credential|token|private.key", name, re.I):
                continue
            if path.suffix not in EXTENSIONS and name != ".gitignore":
                continue
            result[path.relative_to(directory).as_posix()] = encode(path.read_bytes())
    return result


def merge(base, local, remote, label):
    if remote == base or local == remote:
        return local
    if local == base:
        return remote
    if None in (base, local, remote):
        raise ValueError("Sync conflict: " + label)
    contents = [decode(v) for v in [local, base, remote]]
    if any(b"\0" in content for content in contents):
        raise ValueError("Binary sync conflict: " + label)
    with tempfile.TemporaryDirectory(prefix="bb-plugin-merge-") as directory:
        paths = []
        for name, content in zip(["repo", "base", "active"], contents):
            path = Path(directory) / name
            path.write_bytes(content)
            paths.append(str(path))
        result = subprocess.run(["git", "merge-file", "-p", *paths], capture_output=True)
        if result.returncode:
            raise ValueError("Sync conflict: " + label + "; reconcile the active source and repo, then retry")
        return encode(result.stdout)


def atomic_write(path, content, mode=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    mode = mode if mode is not None else (path.stat().st_mode & 0o777 if path.exists() else 0o644)
    fd, temporary = tempfile.mkstemp(prefix=".plugin-sync-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as file:
            file.write(content)
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def sync(root=ROOT, inventory=None):
    root = root.resolve()
    state_dir = root / ".bb/plugin-sync-state"
    state_dir.mkdir(parents=True, exist_ok=True)
    with (state_dir / "lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return []
        query_settings = inventory is None
        if inventory is None:
            inventory = json.loads(subprocess.check_output(["bb", "plugin", "list", "--json"], text=True))["plugins"]
        collection_path = root / ".bb/plugins.json"
        collection_bytes = collection_path.read_bytes()
        collection = json.loads(collection_bytes)
        entries = {p["name"]: p for p in collection["plugins"]}
        state_path = state_dir / "sources.json"
        state = json.loads(state_path.read_text()) if state_path.exists() else {}
        next_state = dict(state)
        changes = {}
        baselines = []
        observed = {}
        modes = {}
        expected = {}
        for plugin in inventory:
            if not plugin["enabled"] or plugin["status"] != "running" or not plugin["source"].startswith("path:"):
                continue
            identity = plugin["id"]
            if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", identity):
                raise ValueError("Unsupported plugin ID: " + identity)
            source = Path(plugin["source"][5:]).resolve()
            manifest = json.loads((source / "package.json").read_text())
            if manifest["name"] != "bb-plugin-" + identity:
                raise ValueError("Plugin manifest identity does not match: " + identity)
            entry = entries.get(identity)
            relative = entry["source"] if entry else "./plugins/" + identity
            unresolved = root / relative
            for component in [unresolved, *unresolved.parents]:
                if component.is_symlink():
                    raise ValueError("Refusing symlink destination: " + str(unresolved))
                if component == root:
                    break
            destination = unresolved.resolve()
            destination.relative_to((root / "plugins").resolve())
            if source == destination:
                if entry is None:
                    collection["plugins"].append({"name": identity, "source": relative})
                    entries[identity] = collection["plugins"][-1]
                continue
            if source == root or root in source.parents or source in root.parents:
                raise ValueError("Refusing a source overlapping this repo: " + identity)
            remote = snapshot(source)
            observed[source] = remote
            local = snapshot(destination) if destination.exists() else {}
            previous = state.get(identity)
            if previous is None and entry:
                # The collection predates sync; its portability patches remain local changes.
                next_state[identity] = {"source": str(source), "base": remote}
                baselines.append(identity)
                continue
            base = previous["base"] if previous else {}
            merged = {}
            for name in sorted(set(base) | set(local) | set(remote)):
                content = merge(base.get(name), local.get(name), remote.get(name), identity + "/" + name)
                if content is not None:
                    merged[name] = content
                if content != local.get(name):
                    path = destination / name
                    changes[path] = decode(content)
                    expected[path] = decode(local.get(name))
                    modes[path] = ((source / name).stat().st_mode & 0o777) if name in remote else None
            if remote != snapshot(source):
                raise ValueError("Plugin changed during capture; retry after editing stops: " + identity)
            # Check that the package planned for capture still has the expected identity.
            planned_manifest = json.loads(decode(merged["package.json"]))
            if planned_manifest["name"] != manifest["name"]:
                raise ValueError("Captured package identity changed: " + identity)
            next_state[identity] = {"source": str(source), "base": remote}
            if entry is None:
                collection["plugins"].append({"name": identity, "source": relative})
                entries[identity] = collection["plugins"][-1]
        preset_path = root / "preset/settings.json"
        if inventory is not None and preset_path.exists():
            local_preset = preset_path.read_bytes()
            base_preset = decode(state.get("_preset")) or local_preset
            captured = json.loads(base_preset)
            plugin_records = {p["id"]: p for p in captured["plugins"]}
            for plugin in inventory:
                identity = plugin["id"]
                if identity in entries:
                    portable_source = "collection:" + identity
                elif plugin["source"].startswith("builtin:"):
                    portable_source = plugin["source"]
                else:
                    continue
                plugin_records[identity] = {"id": identity, "source": portable_source, "enabled": plugin["enabled"]}
            captured["plugins"] = sorted(plugin_records.values(), key=lambda p: p["id"])
            if query_settings:
                for plugin in inventory:
                    if plugin["enabled"] and plugin["status"] == "running" and plugin["id"] in plugin_records:
                        config = json.loads(subprocess.check_output(
                            ["bb", "plugin", "config", plugin["id"], "--json"], text=True))
                        schema = config.get("schema", {})
                        values = {key: value for key, value in config.get("values", {}).items()
                                  if key in schema and not schema[key].get("secret") and schema[key].get("type") != "secret"}
                        if values or plugin["id"] in captured["pluginSettings"]:
                            captured["pluginSettings"][plugin["id"]] = values
            remote_preset = json.dumps(captured, indent=2, ensure_ascii=False).encode() + b"\n"
            content = decode(merge(encode(base_preset), encode(local_preset), encode(remote_preset), "preset/settings.json"))
            if content != local_preset:
                changes[preset_path] = content
                expected[preset_path] = local_preset
            next_state["_preset"] = encode(remote_preset)
        serialized = json.dumps(collection, indent=2).encode() + b"\n"
        if serialized != collection_bytes:
            changes[collection_path] = serialized
            expected[collection_path] = collection_bytes
        # No files are changed if any plugin has a merge conflict.
        for path, content in changes.items():
            if path.is_symlink() or any(parent.is_symlink() for parent in path.parents if parent != root):
                raise ValueError("Refusing symlink destination: " + str(path))
            actual = path.read_bytes() if path.exists() else None
            if actual != expected[path]:
                raise ValueError("Repo file changed during capture: " + str(path))
        for source, files in observed.items():
            if snapshot(source) != files:
                raise ValueError("Active source changed during capture: " + str(source))
        for path, content in changes.items():
            if content is None:
                path.unlink()
            else:
                atomic_write(path, content, modes.get(path))
        serialized_state = json.dumps(next_state, indent=2).encode() + b"\n"
        if not state_path.exists() or state_path.read_bytes() != serialized_state:
            atomic_write(state_path, serialized_state, 0o600)
        if baselines:
            print("Initialized source baselines: " + ", ".join(baselines))
        return [str(path.relative_to(root)) for path in changes]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    changed = sync()
    if changed:
        print("Synced " + str(len(changed)) + " file(s): " + ", ".join(changed))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)

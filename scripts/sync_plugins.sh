#!/bin/sh
# The automation stores this wrapper; it loads current code from its working directory.
set -eu
exec python3 scripts/sync_plugins.py

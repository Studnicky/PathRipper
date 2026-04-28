#!/usr/bin/env bash
# Wrapper that runs @noocodec/enginseer at its latest local build, without
# making it a dependency of this project (no entry in package.json,
# nothing in node_modules). Hits the working tree of the noocodec
# monorepo so we always get the latest commit.
#
# Usage: ./scripts/enginseer.sh <subcommand> [args...]
set -euo pipefail

ENGINSEER_PKG="${ENGINSEER_PKG:-/Users/studs/Workspace/code-quality/noocodec/packages/enginseer}"

if [ ! -d "${ENGINSEER_PKG}" ]; then
  echo "enginseer source not found at: ${ENGINSEER_PKG}" >&2
  echo "Set ENGINSEER_PKG=<path> to override." >&2
  exit 2
fi

exec npx -y -p "file:${ENGINSEER_PKG}" enginseer "$@"

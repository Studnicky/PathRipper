#!/usr/bin/env bash
# Installs the tracked source-of-truth git hooks from `hooks/` into git's
# default location at `.git/hooks/`. Wired up via the npm `prepare` script
# so it runs once after every `npm install` on a developer's clone.
#
# Skips silently when not in a git working tree (e.g., when this package
# is consumed as a dependency from npm).
set -euo pipefail

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  exit 0
fi

GIT_DIR="$(git rev-parse --git-dir)"
HOOK_SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)/hooks"

if [ ! -d "${HOOK_SRC_DIR}" ]; then
  exit 0
fi

mkdir -p "${GIT_DIR}/hooks"
for src in "${HOOK_SRC_DIR}"/*; do
  [ -f "${src}" ] || continue
  name="$(basename "${src}")"
  cp "${src}" "${GIT_DIR}/hooks/${name}"
  chmod +x "${GIT_DIR}/hooks/${name}"
done

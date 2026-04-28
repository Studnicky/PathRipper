#!/usr/bin/env bash
# Lane 07 enforcement: no real target names in source, docs, README, or example config.
# The plan files under docs/plans/ are exempt — they reference banned names by design
# (lane 07 lists them as the things being scrubbed).
set -euo pipefail

# Banned tokens (case-insensitive). Keep this list synced with docs/plans/07-target-neutrality.md.
BANNED='bulbapedia|aonprd|serebii|piazo|pathfinder|pok[ée]mon|charmander|bulbasaur|pkNX|APKMirror|IL2CPP|UnityPy|Perfare|kwsch|SWSH|BDSP'

# Search src/, docs/ (excluding plans/), tests/ (excluding e2e/fixtures/), README.md,
# and the committed example config. Plans and e2e fixtures are exempt: plans
# enumerate banned tokens by design, and e2e fixtures resurrect the legacy
# PathRipper config as a test asset proving this project is the new PathRipper.
HITS=$(
  {
    grep -rniE "${BANNED}" src/ 2>/dev/null || true
    grep -rniE "${BANNED}" docs/  --exclude-dir=plans 2>/dev/null || true
    grep -rniE "${BANNED}" tests/ --exclude-dir=fixtures --exclude-dir=e2e 2>/dev/null || true
    grep -niE  "${BANNED}" README.md 2>/dev/null || true
    grep -niE  "${BANNED}" ripperoni.config.example.json 2>/dev/null || true
  } | grep -v '^$' || true
)

if [ -n "${HITS}" ]; then
  echo "Target-neutrality check failed. Banned tokens found:"
  echo "${HITS}"
  echo
  echo "Fix at the source per docs/plans/07-target-neutrality.md."
  exit 1
fi

echo "Target-neutrality check: clean."

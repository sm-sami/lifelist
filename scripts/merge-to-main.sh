#!/usr/bin/env bash
# Squash a completed phase branch directly into main.
#
# Usage:
#   scripts/merge-to-main.sh "feat: add database foundation"
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

message="${1:-}"
[ -n "$message" ] || {
  echo 'usage: scripts/merge-to-main.sh "<conventional commit message>"'
  exit 2
}

branch="$(git branch --show-current)"
case "$branch" in
  phase/*) ;;
  *)
    echo "ERROR: run this from a completed phase/* branch (current: $branch)."
    exit 1
    ;;
esac

if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: working tree is not clean. Commit the phase changes before merging."
  exit 1
fi

echo "Running final gate…"
pnpm gate
pnpm -r test

git fetch origin main
git switch main
git pull --ff-only origin main
git merge --squash "$branch"
git commit -m "$message"
git push origin main

echo "Merged $branch into main as one commit: $message"

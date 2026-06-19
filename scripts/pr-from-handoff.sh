#!/usr/bin/env bash
# pr-from-handoff.sh — open a PR for the current phase/* branch, using the latest
# session handoff file as the PR body. Agent-agnostic (just git + gh).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT"
SESSIONS="plans/sessions"

b="$(git branch --show-current)"
case "$b" in phase/*) ;; *) echo "Switch to a phase/* branch first (you're on '$b')."; exit 1 ;; esac
slug="${b#phase/}"
id="$(printf '%s' "$slug" | sed 's#-#/#')"

# Latest handoff file for this phase (newest across authors/days).
hf="$(ls -t "$SESSIONS/$slug-"*.md 2>/dev/null | head -1 || true)"
[ -n "$hf" ] || { echo "No handoff found ($SESSIONS/$slug-*.md). Run scripts/session.sh handoff first."; exit 1; }

title="$(head -1 "$hf" | sed -E 's/^#+[[:space:]]*//')"; [ -n "$title" ] || title="$id"

command -v gh >/dev/null 2>&1 || { echo "gh CLI not installed/authenticated."; exit 1; }

git push -u origin "$b" 2>/dev/null || true
gh pr create --base main --head "$b" --title "$title" --body-file "$hf"
echo "PR opened for $id from $hf"

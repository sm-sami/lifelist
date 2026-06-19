#!/usr/bin/env bash
# session.sh — agent-agnostic execution ledger & handoff for plans/.
# Pure git + POSIX shell: any AI agent OR a human can run it. No tool lock-in.
#
# Usage:
#   scripts/session.sh status
#   scripts/session.sh start <phase-id>          # e.g. backend/001
#   scripts/session.sh log "<note>"
#   scripts/session.sh handoff <done|blocked|paused>
#   scripts/session.sh sync
#   scripts/session.sh take-over <phase-id>
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
LEDGER="plans/PROGRESS.md"
SESSIONS="plans/sessions"

email() { git config user.email 2>/dev/null || echo "unknown@local"; }
have_remote() { git remote 2>/dev/null | grep -q .; }
now() { date -u +"%Y-%m-%d %H:%M"; }
today() { date -u +"%Y%m%d"; }
slug() { printf '%s' "$1" | tr '/' '-'; }                 # backend/001 -> backend-001
unslug() { printf '%s' "$1" | sed 's#-#/#'; }             # backend-001 -> backend/001 (first dash)

# pull/push surface failures instead of swallowing them. They set PUSH_FAILED/PULL_FAILED
# so callers (handoff/start) can decide whether to treat the operation as a success.
PULL_FAILED=0
PUSH_FAILED=0
pull() {
  PULL_FAILED=0
  if have_remote; then
    if ! git pull --rebase --autostash; then
      PULL_FAILED=1
      echo "⚠️  git pull failed — your local ledger may be stale vs. the remote." >&2
    fi
  fi
}
push() {
  PUSH_FAILED=0
  if have_remote; then
    if ! git push -u origin "$(git branch --show-current)"; then
      PUSH_FAILED=1
      echo "⚠️  git push failed — teammates will NOT see this update until it lands." >&2
    fi
  fi
}

phase_from_branch() {
  local b; b="$(git branch --show-current 2>/dev/null || true)"
  case "$b" in phase/*) unslug "${b#phase/}" ;; *) echo "" ;; esac
}

# Resolve the plan doc path for a phase id (handles the top-level 000 doc).
doc_path() {
  local id="$1"
  if [ "$id" = "000" ]; then ls plans/000-*.md 2>/dev/null | head -1; return; fi
  local area="${id%%/*}" num="${id##*/}"
  ls "plans/$area/$num-"*.md 2>/dev/null | head -1
}

row_status() { # field 3 (Status) of the row whose Phase cell == id
  awk -F'|' -v id="$1" '{k=$2; gsub(/^ +| +$/,"",k); if(k==id){s=$4; gsub(/^ +| +$/,"",s); print s; exit}}' "$LEDGER"
}
row_owner() {
  awk -F'|' -v id="$1" '{k=$2; gsub(/^ +| +$/,"",k); if(k==id){s=$5; gsub(/^ +| +$/,"",s); print s; exit}}' "$LEDGER"
}

# update_row <id> <status> <owner> <branch> <updated> [notes]
update_row() {
  local id="$1" st="$2" ow="$3" br="$4" up="$5" nt="${6-}"
  local tmp; tmp="$(mktemp)"
  awk -F'|' -v OFS='|' -v id="$id" -v st="$st" -v ow="$ow" -v br="$br" -v up="$up" -v nt="$nt" '
    { k=$2; gsub(/^ +| +$/,"",k)
      if (k==id) { $4=" " st " "; $5=" " ow " "; $6=" " br " "; $7=" " up " "; if (nt!="") $8=" " nt " " }
      print }' "$LEDGER" > "$tmp" && mv "$tmp" "$LEDGER"
}

# handoff file path: plans/sessions/<slug>-<email-localpart>-<YYYYMMDD>.md
hf_path() { local id="$1" e; e="$(email)"; echo "$SESSIONS/$(slug "$id")-${e%%@*}-$(today).md"; }

# Warn (once) if there's no git repo. Multi-author coordination needs git + a remote;
# local-only single-author still works (you just won't share the ledger).
ensure_git() {
  if [ ! -d .git ]; then
    echo "⚠️  No .git directory here. For multi-author coordination, run 'git init' and" >&2
    echo "    add a remote ('git remote add origin <url>') so the ledger + handoffs sync." >&2
    echo "    Local-only single-author use still works, but branches/claims stay on this" >&2
    echo "    machine only." >&2
  elif ! have_remote; then
    echo "ℹ️  git repo has no remote — claims/handoffs are committed locally but not shared." >&2
    echo "    Add one with 'git remote add origin <url>' to coordinate across authors." >&2
  fi
}

ensure_ledger() {
  ensure_git
  [ -f "$LEDGER" ] || { echo "ERROR: $LEDGER missing. Seed it first (see plans/PROGRESS.md)."; exit 1; }
  mkdir -p "$SESSIONS"
}

cmd_status() {
  ensure_ledger; pull
  echo "── In progress ──"
  awk -F'|' '/🟡/{ph=$2;ow=$5;gsub(/^ +| +$/,"",ph);gsub(/^ +| +$/,"",ow);print "  "ph"  ("ow")"}' "$LEDGER" || true
  echo "── Blocked ──"
  awk -F'|' '/🔴/{ph=$2;gsub(/^ +| +$/,"",ph);print "  "ph}' "$LEDGER" || true
  echo "── Next (todo) ──"
  awk -F'|' '/⬜/{ph=$2;gsub(/^ +| +$/,"",ph);print "  "ph}' "$LEDGER" || true
  echo "(see plans/PROGRESS.md for the dependency map before picking)"
}

cmd_start() {
  local id="${1:-}"; ensure_ledger; pull
  if [ -z "$id" ]; then echo "Pick a phase. Todo:"; cmd_status; exit 2; fi
  local st ow me; st="$(row_status "$id")"; ow="$(row_owner "$id")"; me="$(email)"
  if [ -z "$st" ]; then echo "ERROR: phase '$id' not found in $LEDGER"; exit 1; fi
  if echo "$st" | grep -q "🟡" && [ "$ow" != "$me" ] && [ "$ow" != "—" ]; then
    echo "BLOCKED: '$id' is in-progress by $ow. Run 'take-over $id' only if they're AWOL, or pick another."; exit 3
  fi
  local sl br; sl="$(slug "$id")"; br="phase/$sl"
  git switch -c "$br" 2>/dev/null || git switch "$br"
  update_row "$id" "🟡" "$me" "$br" "$(now)"
  local hf; hf="$(hf_path "$id")"
  if [ ! -f "$hf" ]; then
    cat > "$hf" <<EOF
# Handoff — $id

- Author: $me   Branch: $br   Started: $(now)Z   State: in-progress

## Summary
<1–2 lines>

## Progress log

## Done

## Left / next

## Gotchas

## Files touched

## Verification
- pnpm gate: PENDING   tests: n/a
EOF
  fi
  git add "$LEDGER" "$hf"
  git commit -q -m "chore(ledger): claim $id" || true
  push
  if [ "$PUSH_FAILED" -eq 1 ]; then
    echo "⚠️  Claimed $id LOCALLY on $br, but the push failed — another author may not see"
    echo "    the claim and could grab the same phase. Fix the remote and re-push before working."
  else
    echo "Claimed $id on $br. Now read: $(doc_path "$id")"
  fi
}

cmd_log() {
  ensure_ledger
  local id; id="$(phase_from_branch)"; [ -n "$id" ] || { echo "Not on a phase/* branch."; exit 1; }
  local hf; hf="$(hf_path "$id")"; [ -f "$hf" ] || { echo "No session file for today ($hf). Run 'start' first."; exit 1; }
  awk -v note="- $(date -u +%H:%M) — $*" '
    {print}
    /^## Progress log$/{print note}' "$hf" > "$hf.tmp" && mv "$hf.tmp" "$hf"
  echo "logged."
}

cmd_handoff() {
  ensure_ledger; local state="${1:-paused}"
  local id; id="$(phase_from_branch)"; [ -n "$id" ] || { echo "Not on a phase/* branch."; exit 1; }
  local me; me="$(email)"; local hf; hf="$(hf_path "$id")"

  # Definition of Done = `pnpm gate` AND `pnpm -r test`, both green. A 'done' handoff
  # CANNOT succeed without actually running them, so a missing pnpm fails 'done'
  # (you can't prove the gate passed) — it does not silently pass.
  local pnpm_missing=0 gate_rc=0 test_rc=0
  if command -v pnpm >/dev/null 2>&1; then
    echo "Running gate (pnpm gate)…"
    pnpm gate && gate_rc=0 || gate_rc=$?            # capture rc without tripping set -e
    echo "Running tests (pnpm -r test)…"
    pnpm -r test && test_rc=0 || test_rc=$?
  else
    pnpm_missing=1
    echo "⚠️  pnpm not found — cannot run the gate or tests." >&2
  fi

  # Overall pass requires pnpm present AND both commands green.
  local checks_ok=0
  if [ "$pnpm_missing" -eq 0 ] && [ "$gate_rc" -eq 0 ] && [ "$test_rc" -eq 0 ]; then
    checks_ok=1
  fi

  local status notes="" blocked_done=0
  case "$state" in
    done)
      if [ "$checks_ok" -ne 1 ]; then
        status="🔴"; blocked_done=1; state="blocked"
        if [ "$pnpm_missing" -eq 1 ]; then notes="pnpm missing — cannot verify; not done";
        elif [ "$gate_rc" -ne 0 ]; then notes="gate FAILED — not done";
        else notes="tests FAILED — not done"; fi
      else status="✅"; fi ;;
    blocked) status="🔴"; notes="blocked" ;;
    paused|*) status="🟡" ;;
  esac
  update_row "$id" "$status" "$me" "phase/$(slug "$id")" "$(now)" "$notes"

  local gate_word test_word
  gate_word="$([ "$pnpm_missing" -eq 1 ] && echo SKIPPED || { [ "$gate_rc" -eq 0 ] && echo PASS || echo FAIL; })"
  test_word="$([ "$pnpm_missing" -eq 1 ] && echo SKIPPED || { [ "$test_rc" -eq 0 ] && echo PASS || echo FAIL; })"
  if [ -f "$hf" ]; then
    sed -i.bak "s/^- pnpm gate: .*/- pnpm gate: $gate_word   tests: $test_word/" "$hf" && rm -f "$hf.bak"
  fi
  git add "$LEDGER" "$hf" 2>/dev/null || git add "$LEDGER"
  git commit -q -m "chore(ledger): handoff $id ($state)" || true
  push
  echo "Handoff '$state' recorded for $id (gate: $gate_word, tests: $test_word)."

  # Surface real failures with a non-zero exit so the author notices:
  #  - a 'done' that was downgraded because checks failed / pnpm missing, OR
  #  - a push that did not reach the remote (teammates won't see the update).
  if [ "$blocked_done" -eq 1 ]; then
    echo "❌ Cannot mark '$id' done: $notes." >&2
    exit 1
  fi
  if [ "$PUSH_FAILED" -eq 1 ]; then
    echo "❌ Handoff committed locally but push FAILED — re-run after fixing the remote." >&2
    exit 1
  fi
}

cmd_sync() { ensure_ledger; pull; cmd_status; }

cmd_takeover() {
  local id="${1:-}"; ensure_ledger; pull
  [ -n "$id" ] || { echo "usage: take-over <phase-id>"; exit 2; }
  local prev; prev="$(row_owner "$id")"; local me; me="$(email)"
  update_row "$id" "🟡" "$me" "phase/$(slug "$id")" "$(now)" "taken over from $prev on $(today)"
  git add "$LEDGER"; git commit -q -m "chore(ledger): take-over $id from $prev" || true; push
  echo "Took over $id (was $prev)."
}

case "${1:-status}" in
  status)    cmd_status ;;
  start)     shift; cmd_start "${1:-}" ;;
  log)       shift; cmd_log "$@" ;;
  handoff)   shift; cmd_handoff "${1:-paused}" ;;
  sync)      cmd_sync ;;
  take-over) shift; cmd_takeover "${1:-}" ;;
  *) echo "usage: session.sh <status|start|log|handoff|sync|take-over>"; exit 2 ;;
esac

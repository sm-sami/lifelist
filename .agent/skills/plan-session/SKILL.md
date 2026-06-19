---
name: plan-session
description: >-
  Maintain a shared work session, ledger, and handoff while executing the Lifelist
  plans in plans/ — for MULTIPLE authors in parallel without clobbering each other. Use
  when starting/resuming plan work, claiming a phase, logging progress, handing off, or
  checking who's working on what. Triggers: "start a session", "claim a phase", "hand
  off", "plan status", "who's working on X", "resume".
allowed-tools:
  - Bash
  - Read
  - Edit
---

# plan-session

Thin wrapper over the **agent-agnostic** `scripts/session.sh` (pure git + shell — any
agent or human can run it). This skill just runs the script and adds the judgement the
script can't: picking the right next phase, and writing good handoff prose.

## Token discipline (hackathon)
Read **only** `plans/PROGRESS.md` + the **one** phase doc you execute. Never read the
whole `plans/` tree. Keep ledger/handoff entries to a few terse lines.

## What to run

| Intent | Command |
|--------|---------|
| See the board + who owns what | `scripts/session.sh status` |
| Claim a phase, branch, open session | `scripts/session.sh start <phase-id>` (e.g. `backend/001`) |
| Drop a breadcrumb | `scripts/session.sh log "<note>"` |
| End: gate + ledger + push | `scripts/session.sh handoff <done\|blocked\|paused>` |
| Pull + see teammate changes | `scripts/session.sh sync` |
| Reclaim a stale phase | `scripts/session.sh take-over <phase-id>` |

The script handles git optimistic-locking (pull → edit ledger → commit → push), branch
creation (`phase/<id>`), the session handoff file, and runs `pnpm gate` on handoff —
**it will not mark a phase ✅ if the gate fails.**

## Your job around the script
1. **start:** if the user didn't name a phase, run `status`, then pick the first `⬜`
   phase whose dependencies (see the map in `plans/PROGRESS.md`) are all `✅`. Run
   `start <id>`, then open and execute that single phase doc. Track sub-steps however
   your agent tracks work (todo list, scratchpad — tool-agnostic).
2. **during:** use `log` for breadcrumbs at meaningful checkpoints.
3. **handoff:** before running it, fill the session file's
   `Summary / Done / Left / Gotchas / Files touched` sections tersely by editing
   `plans/sessions/<id>-<you>-<date>.md`. Then run `handoff done` (or `blocked`/`paused`).
   If the gate fails, the script flips it to `🔴` — report why.

## Rules
- One author → one in-progress phase → one `phase/<id>` branch. Never edit code on `main`.
- If `start` reports a phase is already `🟡` under someone else, pick another or coordinate.

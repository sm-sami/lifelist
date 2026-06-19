---
name: pr-from-handoff
description: >-
  Open a pull request for the current Lifelist phase branch, using the latest session
  handoff file as the PR body. Use after finishing/handing off a phase. Triggers: "open
  a PR", "raise a PR for this phase", "PR from my handoff", "ship this phase".
allowed-tools:
  - Bash
  - Read
---

# pr-from-handoff

Thin wrapper over the agent-agnostic `scripts/pr-from-handoff.sh` (git + `gh`).

## Run
```bash
scripts/pr-from-handoff.sh
```
It must be run on a `phase/<id>` branch. It pushes the branch, finds the newest
`plans/sessions/<id>-*.md` handoff, and opens a PR with that handoff as the body and its
H1 as the title.

## Your job around it
1. First ensure the handoff is current — ideally run `plan-session handoff done|blocked`
   so the gate result and Summary/Done/Left sections are filled.
2. Run the script. If `gh` reports it isn't authenticated, tell the user to run
   `gh auth login` (don't attempt it for them).
3. Relay the PR URL the script prints.

Keep it cheap: read only the handoff file if you need to summarize it; don't re-read the
phase doc.

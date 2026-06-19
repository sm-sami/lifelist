---
name: merge-to-main
description: >-
  Integrate a completed Lifelist phase branch directly into main as one squash commit.
  Ledger claim and handoff commits remain on the phase branch and do not enter main.
  Use after a successful done handoff. Triggers: "merge to main", "ship this phase",
  "integrate this phase", "land this phase", "merge directly".
allowed-tools:
  - Bash
  - Read
---

# merge-to-main

Thin wrapper over the agent-agnostic `scripts/merge-to-main.sh`.

## Required input

Obtain a concise conventional commit message that describes the implementation:

```text
chore: implement workspace tooling
feat: add database foundation
fix: harden token verification
```

Do not include phase identifiers such as `phase 000`, `backend/001`, or ticket-style
numbers unless the user explicitly requests them.

## Preconditions

1. The current branch is `phase/<id>`.
2. `scripts/session.sh handoff done` has completed successfully.
3. The working tree is clean.
4. The phase branch has been pushed.

If the user asks to merge immediately but the handoff is not complete, run:

```bash
scripts/session.sh handoff done
```

Stop if the gate or tests fail.

## Run

```bash
scripts/merge-to-main.sh "<conventional commit message>"
```

The script:

1. Reruns `pnpm gate` and `pnpm -r test`.
2. Fetches and updates `main`.
3. Squash-merges the current phase branch.
4. Creates one commit using the supplied message.
5. Pushes `main`.

Ledger/session commits stay on the phase branch. Do not separately merge, rebase, or
fast-forward the phase branch into `main`.

## Report

After success, report:

- the resulting `main` commit SHA and subject;
- that gate and tests passed;
- that `main` contains one squash commit for the phase.

If the push fails, report that the local `main` commit exists but is not on the remote.

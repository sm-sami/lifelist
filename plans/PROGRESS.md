# Lifelist — Execution Ledger

> Shared board for executing `plans/`. Maintained by the **`/plan-session`** skill.
> Status: ⬜ todo · 🟡 in-progress · 🔴 blocked · ✅ done.
> A phase is only `✅` once `pnpm gate` passes. Claim a phase before working it; commit +
> push every change to this file immediately so the board never drifts across authors.

## Board

| Phase | Title | Status | Owner | Branch | Updated (UTC) | Notes |
|-------|-------|--------|-------|--------|---------------|-------|
| 000 | Conventions & tooling (pnpm workspace, Biome, gate) | ✅ | srmf2025@gmail.com | phase/000 | 2026-06-19 10:06 | do first; unblocks everything |
| backend/001 | Supabase Postgres + Drizzle setup | ⬜ | — | — | — | |
| backend/002 | Supabase auth + Hono JWT middleware | ⬜ | — | — | — | |
| backend/003 | AI embeddings + pgvector de-dup | ⬜ | — | — | — | |
| backend/004 | LLM classify, gradient, Unsplash, /items/create | ⬜ | — | — | — | |
| backend/005 | Headout v3 search proxy | ⬜ | — | — | — | live GET contract pinned 2026-06-19 |
| frontend/001 | Expo Router scaffold + theming + Halyard | ⬜ | — | — | — | |
| frontend/002 | Dashboard grid + glass (Headout re-skin) | ⬜ | — | — | — | |
| frontend/003 | Smart-Add overlay + debouncer | ⬜ | — | — | — | |
| frontend/004 | Item detail parallax + bottom sheet | ⬜ | — | — | — | |
| frontend/005 | Celebration canvas + hold-to-stamp | ⬜ | — | — | — | |
| integration/001 | Data-layer plumbing (JWT client + stores) | ⬜ | — | — | — | |
| integration/002 | Media pipeline (private Storage + signed URLs) | ⬜ | — | — | — | |
| integration/003 | Realtime item sync (private enrichment push) | ⬜ | — | — | — | |

## Dependency map (what unblocks what — for parallelizing across authors)

```
000 ─┬─> backend/001 ─┬─> backend/002 ─┐
     │                ├─> backend/003 ─┼─> backend/004 ──> backend/005
     │                                 │
     └─> frontend/001 ─┬─> frontend/002
                       ├─> frontend/005   (lands early — frontend/004 embeds its button)
                       ├─> frontend/003   (also needs backend/004 + integration/001)
                       └─> frontend/004   (embeds frontend/005's HoldToStampButton)

   Integration layer (wires the two halves — these are NOT independent):
     backend/002 + backend/004 ───────────────────────────────> integration/001
     integration/001 + backend/004 ───────────────────────────> frontend/003
     integration/001 + backend/005 + frontend/005 ────────────> frontend/004
     integration/001 + frontend/004 ──────────────────────────> integration/002
     integration/001 + backend/004 ───────────────────────────> integration/003
```

**What's actually independent (be careful — most of frontend is NOT):**
- After **000**, the `backend/*` chain and `frontend/001/002/005` can run in parallel.
  `frontend/005` (celebration canvas + HoldToStampButton) should land early because
  `frontend/004` embeds its button.
- **frontend/003** (Smart-Add) needs **backend/004** (`/items/create` + `/items/precheck`)
  AND **integration/001** (the API client + items store) — it is not free after 001.
- **frontend/004** (item detail) needs **backend/005** (experiences proxy) +
  **integration/001** + **frontend/005** (the embedded HoldToStampButton).
- **integration/001** needs **backend/002** (auth/JWT) + **backend/004** (the items API).
- **integration/002** (media) needs **integration/001** + **frontend/004** (where the
  ChangePhotoButton mounts).
- **integration/003** (realtime item sync) needs **integration/001** + **backend/004**
  (it consumes the private `item.enriched` broadcast the enrich job emits).

## How to use
- `/plan-session status` — see the board + next free phases.
- `/plan-session start [phase]` — claim + branch + begin.
- `/plan-session log "note"` — drop a breadcrumb.
- `/plan-session handoff done|blocked|paused` — run the gate, write the handoff, update this board.
- `scripts/merge-to-main.sh "<conventional commit message>"` — squash a completed phase
  directly into `main`; ledger-only commits do not enter main history.
- `/plan-session sync` — pull and see what teammates changed.

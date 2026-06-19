# Lifelist — agent guide

> Cross-agent source of truth (the `AGENTS.md` convention). `CLAUDE.md` imports this
> file; Cursor/Codex/Aider/Cline/Windsurf and humans read it directly. All coordination
> is **deterministic shell scripts** in `scripts/` — no specific AI tool is required.

AI bucket-list app. Greenfield. The full build is specified in `plans/` (start with
`plans/000-conventions-and-tooling.md`). Execution is coordinated by the ledger in
`plans/PROGRESS.md`.

## Move fast, spend few tokens
- To work a phase: `scripts/session.sh start <id>`, then read **only** that phase doc + this file.
  Do **not** read the whole `plans/` tree.
- Board: `scripts/session.sh status`. Hand off: `scripts/session.sh handoff done`.
- Integrate a completed phase: `scripts/merge-to-main.sh "<conventional commit message>"`.
- Trust this file for conventions instead of re-exploring the repo.

## Agent-agnostic scripts (`scripts/`)
These do the real work with plain git + POSIX shell, so any agent or a human can run them:

| Script | What it does |
|--------|--------------|
| `scripts/session.sh <status\|start\|log\|handoff\|sync\|take-over> [args]` | Claim/branch/ledger/handoff with git optimistic locking + runs the gate on handoff |
| `scripts/merge-to-main.sh "<message>"` | Runs the gate, squash-merges the completed phase directly to `main`, commits once, and pushes |
| `scripts/scaffold-screen.sh <screen\|component> <Name>` | Generates a new Expo file pre-wired with `useTheme()` + safe-area + Halyard tokens |

The `.agent/skills/*` files are thin wrappers that call these scripts; the
scripts are the portable implementation.

## Stack (locked — don't re-litigate)
- **Monorepo:** pnpm workspace. `apps/backend` (Hono/Node), `apps/mobile` (Expo), `packages/shared` (DTOs+zod). Root `.npmrc` has `node-linker=hoisted` — a **compatibility choice**, not a hard requirement (modern Expo supports pnpm isolated installs; we keep hoisted for fewer native-resolution surprises). **Expo SDK is pinned to 56** so the project runs in the current Expo Go.
- **Backend:** Hono on **Vercel Node** serverless. Drizzle + `postgres.js` over Supabase **Supavisor transaction pooler (6543, `prepare:false`)** at runtime; **direct 5432** for `drizzle-kit` migrations.
- **DB/AI:** Supabase Postgres + `pgvector(1536)`. **OpenAI for both** embeddings (`text-embedding-3-small`) and classification (structured outputs — no `minItems`/`maxItems`, validate with zod). Semantic de-dup is **per-user**, predicate `embedding <=> $q < 0.15` (cosine *distance* = 0.85 similarity), no vector index.
- **Auth/Storage/Realtime:** Supabase. App talks to Hono (writes/AI/proxies) **and** directly to Supabase (auth/storage/realtime) → **RLS is the security boundary** for the direct paths.
- **Third-party (proxied via Hono):** Unsplash (server-side key; portrait card art) and
  **Headout v3 search** `GET https://search.headout.com/api/v3/search/` (public free-text
  `query`; grouped `results[]`, with `PRODUCT.values[]` carrying `displayName` + `urlSlug`).
- **Mobile:** Expo + expo-router + Reanimated + gesture-handler + gorhom/bottom-sheet + Skia.

## Design system (Headout DNA)
- Tokens in `apps/mobile/lib/{tokens,theme}.ts`. **Both light + dark; dark is primary** (canvas `#0C0A14`).
- Brand: purps **`#8000ff`** (accent), candy **`#ff007a`**. Radii **8/12**. Subtle shadows (`#111` @ ~0.10). Font **Halyard** (bundled from `proteus`), light-300 body weight.
- Components read `const { colors, radius, type } = useTheme()` in the body — **never** `import { theme }` for new code. Only layout lives in `StyleSheet.create`; colors are applied inline so light/dark works.
- Every screen uses `useSafeAreaInsets` (Android is edge-to-edge). `scaffold-screen.sh` bakes this in.

## The gate (Definition of Done for every phase)
```bash
pnpm gate        # tsc --noEmit (all pkgs) + biome lint + biome format check
pnpm -r test     # phase tests
```
Both must exit 0. **Never mark a phase ✅ in the ledger if the gate fails** (`session.sh handoff` enforces this).

## Addenda (`plans/addendum/`)

Addenda are cross-cutting corrections to already-written phase plans — architecture
changes, security fixes, or approach improvements discovered during execution.

- Each addendum lives at `plans/addendum/<NNN>-<name>.md` and lists which phases it
  **affects** in its header.
- **Before starting any phase**, run `ls plans/addendum/` and read any addendum whose
  `Affects:` list includes your phase. Addenda override the original phase doc where
  they conflict.
- Addenda are tracked in `plans/PROGRESS.md` (separate section) and follow the same
  branch/gate/merge workflow as phases: `phase/addendum-<NNN>`.
- The `scripts/session.sh` script handles addendum IDs (`addendum/001`) identically to
  phase IDs — `start`, `handoff`, and `merge-to-main.sh` all work unchanged.

## Conventions
- pnpm only (`pnpm add`, `pnpm <script>`, `pnpm tsx`, `pnpm expo`). Never npm/npx.
- Work on `phase/<id>` branches, never directly on `main`.
- Ledger claim/handoff commits stay on phase branches. Integrate with
  `scripts/merge-to-main.sh` so `main` receives one squash commit and no standalone
  ledger commits.
- Use a concise conventional commit describing the implementation, without phase numbers
  (for example `chore: implement workspace tooling`).
- Shared types live in `packages/shared` — change a DTO there, both apps' typechecks enforce it.

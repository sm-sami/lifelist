# Lifelist

*Things you want to do before you die should not live in a forgotten notes app.*

---

You type something like "see the northern lights" — just that, casual and human — and Lifelist turns it into a card with a category, an image, a check for duplicates, and a list of experiences you can actually book. It remembers that `Northern lights` and `Experience aurora borealis` are the same dream. It pulls a photograph from Unsplash. It surfaces real bookable options through Headout. When you finally do it, you stamp it done.

That's the whole idea: a bucket list that understands intent, not just text.

---

## What it does

- **Natural language input.** No dropdowns or categories to pick. Just type the thing you want to do.
- **AI enrichment.** Classification, image search, and duplicate detection run in the background. The card upgrades itself.
- **Semantic dedup.** pgvector cosine similarity catches the same goal written two different ways before you add it twice.
- **Experiences.** Open any item and see bookable options from Headout — real products, real prices, real links.
- **Completion flow.** Hold the stamp to mark something done. It looks good when you do.
- **Filters and search.** Status, category, free text. Grows with the list.
- **Realtime.** Enrichment results arrive over Supabase Realtime — no refresh needed.

---

## Stack

| Layer | Choices |
|-------|---------|
| Mobile | Expo SDK 56, React Native, Expo Router, Reanimated, Skia |
| Backend | Hono, Node, Vercel serverless |
| Database | Supabase Postgres + pgvector |
| Auth / Storage / Realtime | Supabase |
| AI | OpenAI — `text-embedding-3-small` + structured classification |
| External | Unsplash (imagery), Headout (experiences) |
| ORM | Drizzle |
| Contracts | Zod DTOs in `packages/shared`, shared by both apps |
| Tooling | pnpm, TypeScript, Biome, Lefthook, Vitest, Jest |

---

## Repo layout

```
apps/
  backend/   Hono API — enrichment, duplicate detection, Unsplash + Headout proxies
  mobile/    Expo app — the thing you actually use

packages/
  shared/    DTO schemas consumed by both apps

supabase/    Local Supabase config and migrations
plans/       Build specs and phase notes from the hackathon
```

---

## Running locally

Full setup guide: [SETUP.md](./SETUP.md). Short version:

```bash
pnpm install
pnpm supabase:start

# Run migrations
cd apps/backend
source .env.local
pnpm db:migrate

# Two terminals:
pnpm dev                          # backend
pnpm --filter mobile expo start   # Expo
```

You'll need `.env.local` files for both apps covering Supabase, OpenAI, Unsplash, and the API base URL. Copy the `.env.example` files — keep secrets out of git.

---

## Gate

```bash
pnpm gate      # tsc --noEmit + Biome lint + format check
pnpm -r test   # unit tests across all packages
```

The pre-commit hook runs the gate. Both must be green before anything merges.

---

## Honest notes

This is a hackathon prototype — built fast, with taste, but with the usual tradeoffs.

Some "AI understanding" is assisted by deterministic aliases. Enrichment is asynchronous and best-effort. Third-party APIs can be weird. Production hardening is incomplete. The product is still being discovered by using it.

But the architecture isn't toy-shaped. Shared contracts, RLS, per-user storage, migrations, tests, and a gate are all here because even hackathon code is allowed to have a spine.

---

Hackathon prototype. Public so the idea, implementation, and iteration trail are visible.

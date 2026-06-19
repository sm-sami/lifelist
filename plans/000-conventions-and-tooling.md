# 000 — Conventions & Tooling (read first)

> Cross-cutting setup every phase depends on: the **pnpm workspace** layout, the
> `.npmrc` settings Expo requires, the **shared types package** that keeps the backend
> and mobile app in lockstep, and the **lint + typecheck gate** that must pass at the
> end of every phase. All other plan docs assume this is in place.

---

## 🎯 Objective

1. Standardize on **pnpm** (workspace/monorepo) so backend, mobile, and shared code
   share one lockfile and one dependency graph.
2. Eliminate type drift between Hono and Expo with a **`packages/shared`** module that
   is the single source of truth for API DTOs and zod schemas.
3. Make code consistency enforceable, not aspirational: **Biome** (lint + format) +
   **`tsc --noEmit`** (typecheck), run as a **Definition-of-Done gate after every
   phase** and in CI.

---

## 💻 Code & Configuration Blueprints

### 1. Workspace layout

```
lifelist/
├── pnpm-workspace.yaml
├── .npmrc                      # node-linker=hoisted (compat choice for Expo/Metro — see §3)
├── package.json                # root scripts: typecheck / lint / format across all pkgs
├── biome.json                  # shared lint + format config
├── tsconfig.base.json          # shared compiler options; each pkg extends this
├── apps/
│   ├── backend/                # Hono on Node (backend/* docs)  → was "backend/"
│   └── mobile/                 # Expo app (frontend/* docs)     → was the app root
└── packages/
    └── shared/                 # DTOs + zod schemas imported by BOTH apps
```

> **Path note:** the per-phase docs write paths relative to their package root (e.g.
> `db/schema.ts`, `app/_layout.tsx`). Under this workspace they live at
> `apps/backend/db/schema.ts` and `apps/mobile/app/_layout.tsx` respectively.

### 2. `pnpm-workspace.yaml`

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

### 3. `.npmrc` (root) — `node-linker=hoisted` is a compatibility choice

```ini
# COMPATIBILITY CHOICE (not universally mandatory): modern Expo DOES support pnpm's
# default isolated (symlinked) install, but historically Metro + some native modules
# tripped over the symlinked node_modules layout. We keep a flat (hoisted) install for
# fewer native-resolution surprises across the workspace. If you ever switch to isolated,
# expect to debug Metro module resolution.
node-linker=hoisted

# Keep the lockfile honest in CI.
strict-peer-dependencies=false
auto-install-peers=true
```

> The Hono backend is happy with pnpm's default isolated layout, and modern Expo can run
> isolated too — but because this is a single workspace the root `.npmrc` applies to all
> packages, so `hoisted` is the low-friction choice that satisfies every package without
> per-package debugging. This is a deliberate trade-off, not a hard requirement.

#### Pin versions (don't float)

- **Pin the Expo SDK to 56** in `apps/mobile/package.json` (`"expo": "~56.0.0"`) and install
  Expo-managed deps with `pnpm expo install` so they resolve to versions compatible with
  that SDK. The whole `hoisted`-vs-isolated story above is SDK-version-specific, so a
  floating SDK undermines it.
- Pin tool versions too: pnpm through the root `packageManager` field, plus Biome,
  TypeScript, and the test runners (§ Testing setup). Commit the lockfile and let CI
  install with `--frozen-lockfile`.

### 4. pnpm command map (use these everywhere instead of npm/npx)

| Task                         | npm/npx (don't use)              | pnpm (use this)                       |
| ---------------------------- | -------------------------------- | ------------------------------------- |
| Init a package               | `npm init -y`                    | `pnpm init`                           |
| Add a dependency             | `npm install X`                  | `pnpm add X`                          |
| Add a dev dependency         | `npm install -D X`               | `pnpm add -D X`                       |
| Add to a specific workspace  | —                                | `pnpm --filter backend add X`         |
| Run a package script         | `npm run dev`                    | `pnpm dev`                            |
| Run script in all packages   | —                                | `pnpm -r <script>`                    |
| Run a local bin              | `npx tsx file.ts`                | `pnpm tsx file.ts`                    |
| One-off remote tool          | `npx create-expo-app`            | `pnpm create expo-app`                |
| Expo CLI (local bin)         | `npx expo install X`             | `pnpm expo install X`                 |

### 5. Root `package.json` scripts

```json
{
  "name": "lifelist",
  "private": true,
  "packageManager": "pnpm@10.33.0",
  "engines": { "node": ">=20.19 <27" },
  "scripts": {
    "typecheck": "pnpm -r typecheck",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "format": "biome format --write .",
    "format:check": "biome format .",
    "gate": "pnpm typecheck && pnpm lint && pnpm format:check"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "typescript": "^5.6.0"
  }
}
```

Each package adds its own `typecheck`:

```jsonc
// apps/backend/package.json (and apps/mobile, packages/shared)
"scripts": { "typecheck": "tsc --noEmit" }
```

### 6. `biome.json` (shared lint + format — one fast tool, no ESLint+Prettier sprawl)

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "organizeImports": { "enabled": true },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": { "noExplicitAny": "warn" },
      "style": { "useImportType": "error", "noNonNullAssertion": "off" }
    }
  },
  "files": { "ignore": ["**/drizzle/**", "**/.expo/**", "**/node_modules/**", "**/dist/**"] }
}
```

> Biome is chosen over ESLint+Prettier for speed and a single config. If you prefer the
> Expo-blessed ESLint config for the mobile app, run `pnpm create expo-config` there and
> keep Biome for the backend + shared — but a single Biome config is simpler and what
> the rest of these docs assume.

### 7. `packages/shared` — the anti-drift layer (answers "how do we keep types safe?")

```ts
// packages/shared/src/dto.ts
import { z } from "zod";

/** The sanitized Headout experience — the ONLY shape the client sees (backend/005). */
export const ExperienceSchema = z.object({
  title: z.string(),
  description: z.string(),
  priceToken: z.string(),
  rating: z.number().min(0).max(5).nullable(),
  bookingUrl: z.string().url(),
});
export type Experience = z.infer<typeof ExperienceSchema>;

/** A category as expanded onto an item for rendering the card gradient (backend/004). */
export const CategoryDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  gradientStart: z.string(),
  gradientEnd: z.string(),
});
export type CategoryDto = z.infer<typeof CategoryDtoSchema>;

/**
 * The item DTO returned by the API and rendered by the app (integration/001).
 * `GET /api/items` and `GET /api/items/:id` return this with `category` EXPANDED
 * (the joined CategoryDto, not just `categoryId`) so the UI can draw the gradient
 * without a second fetch. This is the SINGLE source of truth — both apps import it.
 */
export const ItemDtoSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  notes: z.string().nullable(),
  imageUrl: z.string().nullable(),
  imageAttribution: z.string().nullable(),
  imageAttributionUrl: z.string().nullable(),
  status: z.enum(["pending_enrichment", "active", "completed"]),
  categoryId: z.string().uuid().nullable(),
  category: CategoryDtoSchema.nullable(), // EXPANDED join — drives the card gradient
  completedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type ItemDto = z.infer<typeof ItemDtoSchema>;
```

- **Backend** imports these to validate responses before sending. `GET /api/items` and
  `GET /api/items/:id` return `ItemDto` with `category` expanded; `POST /api/items/create`
  takes `{ title, notes?, force? }`; complete/image PATCHes return `ItemDto`.
- **Mobile** imports the **same** types/schemas — `store/types.ts` re-exports `ItemDto`
  as `Item` and `CategoryDto` as `Category` (integration/001), so there is exactly one
  definition of the shape.
- Optionally use **`drizzle-zod`** (`createSelectSchema(items)`) so the DB schema, the
  API contract, and the client type all derive from one definition — change a column
  once and every layer's types update.

### 8. Testing setup — makes `pnpm -r test` real

The phase docs sprinkle test snippets; this is the runner wiring that makes them
executable. **Vitest** for the Node packages, **jest-expo** for the React-Native app.

**`apps/backend` + `packages/shared` — Vitest.**

```bash
pnpm --filter backend add -D vitest
pnpm --filter @lifelist/shared add -D vitest
```

```ts
// apps/backend/vitest.config.ts  (and an identical one in packages/shared/)
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.{test,spec}.ts"],
  },
});
```

```jsonc
// apps/backend/package.json (and packages/shared/package.json)
"scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" }
```

**`apps/mobile` — jest-expo.**

```bash
pnpm --filter mobile add -D jest jest-expo @types/jest @testing-library/react-native
```

```jsonc
// apps/mobile/package.json
"scripts": { "typecheck": "tsc --noEmit", "test": "jest" },
"jest": { "preset": "jest-expo" }
```

> `vitest run` and `jest` (non-watch) both exit non-zero on failure, so `pnpm -r test`
> fails the whole run if any package's tests fail. Packages without tests yet still need
> a `"test"` script (even `"test": "vitest run --passWithNoTests"`) so `pnpm -r test`
> doesn't error on a missing script.

**Definition of Done = two commands, both green:**

```bash
pnpm gate      # tsc --noEmit (all pkgs) + biome lint + biome format check
pnpm -r test   # Vitest (backend, shared) + Jest (mobile) unit tests
```

`pnpm gate` covers typecheck + lint + format; `pnpm -r test` runs the unit tests. A
phase is only done when BOTH exit 0 (`scripts/session.sh handoff done` enforces both).

---

## 🚶 Step-by-Step Execution Guide

1. **Install pnpm 10.33.0 directly** (for example `brew install pnpm` on macOS, then
   `pnpm self-update 10.33.0`). Corepack is optional userland tooling and is not assumed
   to be bundled with Node. Confirm `pnpm --version` matches the root `packageManager`.
2. **Create the workspace root:** `pnpm-workspace.yaml` (§2), `.npmrc` (§3) — keep
   `node-linker=hoisted` as the compatibility choice (§3) and pin the Expo SDK to 56.
   Add the root `package.json` (§5) and `biome.json` (§6).
3. **Scaffold packages:** `apps/backend` (backend/001), `apps/mobile` (frontend/001),
   `packages/shared` (§7). Each gets a `tsconfig.json` extending `tsconfig.base.json`
   and a `typecheck` script.
4. **Wire shared types:** add `@lifelist/shared` as a workspace dependency in both apps
   (`pnpm --filter backend add @lifelist/shared@workspace:*`) and import DTOs from it
   instead of redefining shapes.
5. **Wire the test runners** (§8): Vitest in `apps/backend` + `packages/shared`,
   jest-expo in `apps/mobile`. Give every package a `"test"` script so `pnpm -r test`
   resolves in all of them.
6. **Verify the gate runs:** `pnpm gate` from the root should typecheck every package,
   lint, and check formatting; `pnpm -r test` should run all unit tests.
7. **Add a pre-commit hook** (lefthook or husky) running `pnpm gate` on staged files,
   and a CI job (GitHub Actions) running `pnpm install --frozen-lockfile && pnpm gate &&
   pnpm -r test`.

### Definition of Done — applies to EVERY phase

> Every phase doc's 🧪 section ends with this gate. A phase is not "done" until:
>
> ```bash
> pnpm gate            # typecheck (tsc --noEmit, all pkgs) + biome lint + format check
> pnpm -r test         # any unit tests added in the phase
> ```
>
> Both must exit 0 before moving to the next phase.

---

## 🧪 Verification & Test Protocols

### A. Workspace resolves

```bash
pnpm install
pnpm -r exec node -e "console.log(process.cwd())"
# Lists each package dir → workspace is wired.
```

### B. Expo runs under hoisted node_modules

```bash
pnpm --filter mobile expo start
# Metro bundles with no "module not found / symlink" errors → .npmrc hoisting works.
```

### C. The gate fails on bad code (proves it's real)

Introduce a deliberate type error (`const x: number = "nope"`) and an unused import,
then:

```bash
pnpm gate
# Non-zero exit: tsc reports the type error, biome reports the unused import.
```

Revert and confirm `pnpm gate` exits 0.

### D. Shared types prevent drift

Change a field in `packages/shared/src/dto.ts` (e.g. rename `priceToken`). Run
`pnpm typecheck` — **both** the backend and mobile packages should fail to compile until
updated, proving the single-source-of-truth contract.

✅ **Phase complete when:** `pnpm install` wires the workspace, Expo bundles under
hoisted node_modules, `pnpm gate` passes clean and fails on bad code, and a change to a
shared DTO breaks both apps' typechecks until reconciled.

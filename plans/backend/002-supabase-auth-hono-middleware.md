# Backend 002 — Supabase Auth + Hono JWT Middleware

> Phase 2 of the Lifelist backend. The Expo client authenticates against Supabase Auth
> and receives a JWT. This phase makes Hono **verify** that JWT on every protected
> route, extract the user id, lazily provision the app-side `users` row, and expose a
> type-safe `c.get("userId")` to downstream handlers.

---

## 🎯 Objective

1. Capture the `Authorization: Bearer <jwt>` header in Hono.
2. Verify the Supabase access token through `supabase.auth.getUser(token)`. Supabase
   Auth performs authoritative server-side validation regardless of the project's JWT
   signing algorithm, so Lifelist does not require separate JWT algorithm or signing
   secret variables.
3. Extract the authenticated user id from the `sub` claim and store it on the Hono
   context via `c.set("userId", ...)` with full TypeScript typing.
4. Lazily **upsert** the corresponding `users` row on first authenticated request
   (Supabase owns identity; our table is a projection — see `backend/001`).
5. Return a clean `401` on any missing/invalid/expired token.

---

## 💻 Code & Configuration Blueprints

### 1. Dependencies

```bash
pnpm add @supabase/supabase-js
```

### 2. Environment variables (add to the matrix from backend/001)

| Variable                 | Value                               | Notes                                      |
| ------------------------ | ----------------------------------- | ------------------------------------------ |
| `SUPABASE_URL`           | `https://<PROJECT_REF>.supabase.co` | Supabase Auth endpoint.                    |
| `SUPABASE_SECRET_KEY`    | Dashboard → Settings → API Keys     | Server-only; never include in Expo config. |

### 3. Context typing — `src/types.ts`

```ts
// src/types.ts
import type { Item, Category, User } from "../db/schema";

/**
 * Variables stored on the Hono context by middleware. Augmenting Hono's generic
 * `Variables` here makes c.get/c.set fully type-safe across the app.
 */
export type AppVariables = {
  userId: string; // Supabase auth user id (UUID) — set by authMiddleware
  userEmail: string; // convenience copy of the verified email claim
};

export type AppBindings = {
  // Reserved for platform bindings; empty on Vercel Node.
};

export type AppEnv = {
  Variables: AppVariables;
  Bindings: AppBindings;
};

// Re-export row types for handlers.
export type { Item, Category, User };
```

### 4. Token verifier — `src/auth/verify-token.ts`

```ts
// src/auth/verify-token.ts
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
if (!SUPABASE_URL) throw new Error("SUPABASE_URL is not set.");
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
if (!SUPABASE_SECRET_KEY) throw new Error("SUPABASE_SECRET_KEY is not set.");

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

/**
 * Supabase access-token payload (the claims we rely on).
 */
export interface SupabaseJwtPayload {
  sub: string; // user id (UUID)
  email?: string; // OPTIONAL — phone-auth/anonymous users have none
  phone?: string; // present for phone-auth users
  role?: string; // typically "authenticated"
  // OAuth providers (Google/GitHub/Apple) populate these on the access token.
  user_metadata?: {
    avatar_url?: string;
    picture?: string;
    full_name?: string;
    name?: string;
  };
}

export type VerifyResult =
  | { ok: true; payload: SupabaseJwtPayload }
  | { ok: false; reason: "invalid" | "unavailable" };

/**
 * Verifies a Supabase access token. Returns a discriminated result rather than
 * throwing, so the middleware can map cleanly to HTTP status codes.
 */
export async function verifySupabaseToken(token: string): Promise<VerifyResult> {
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      return {
        ok: false,
        reason: error?.status === 0 || (error?.status ?? 0) >= 500 ? "unavailable" : "invalid",
      };
    }

    return {
      ok: true,
      payload: {
        sub: data.user.id,
        email: data.user.email,
        phone: data.user.phone,
        role: data.user.role,
        user_metadata: data.user.user_metadata,
      },
    };
  } catch (err) {
    console.error("[auth] token verifier unavailable", err);
    return { ok: false, reason: "unavailable" };
  }
}
```

### 4b. Avatar resolution — `src/auth/avatar.ts`

```ts
// src/auth/avatar.ts
import type { SupabaseJwtPayload } from "./verify-token";

/**
 * Resolves an avatar URL for a user. Strategy:
 *  1. If they signed in with an OAuth provider (Google/GitHub/Apple), Supabase puts the
 *     provider's photo in user_metadata.avatar_url|picture — use it verbatim.
 *  2. Otherwise (email/password) there is no photo, so we GENERATE a deterministic one
 *     from DiceBear seeded by the user id. Same id → same avatar forever, no storage,
 *     no extra request from us (the URL is served by DiceBear / can be self-hosted).
 *
 * Alternative (on-brand): render initials over the user's procedural dark-purple
 * gradient (reuse generateGradient from backend/004) into an SVG and upload once to
 * Supabase Storage. DiceBear is the zero-infra default; swap here if desired.
 */
const DICEBEAR_STYLE = "thumbs"; // calm, abstract; good on a dark canvas

export function resolveAvatarUrl(payload: SupabaseJwtPayload): string {
  const fromOAuth = payload.user_metadata?.avatar_url ?? payload.user_metadata?.picture;
  if (fromOAuth) return fromOAuth;
  const seed = encodeURIComponent(payload.sub);
  return `https://api.dicebear.com/9.x/${DICEBEAR_STYLE}/png?seed=${seed}&backgroundType=gradientLinear`;
}

export function resolveDisplayName(payload: SupabaseJwtPayload): string | null {
  // Never expose a phone number as a display name. Phone-auth users without profile
  // metadata remain unnamed until they choose a name.
  return (
    payload.user_metadata?.full_name ??
    payload.user_metadata?.name ??
    payload.email?.split("@")[0] ??
    null
  );
}
```

### 5. The middleware — `src/auth/middleware.ts`

```ts
// src/auth/middleware.ts
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../types";
import { db } from "../../db/client";
import { users } from "../../db/schema";
import { verifySupabaseToken } from "./verify-token";
import { resolveAvatarUrl, resolveDisplayName } from "./avatar";

/**
 * Extracts the bearer token from the Authorization header.
 * Returns null if the header is absent or malformed.
 */
function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

/**
 * authMiddleware — verifies the Supabase JWT, provisions the app-side users row,
 * and populates the typed context (userId, userEmail).
 *
 * Mount on every protected route group. Error messages are stable machine codes consumed
 * by the mobile auth-recovery path.
 */
export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const token = extractBearer(c.req.header("Authorization"));
  if (!token) {
    throw new HTTPException(401, { message: "unauthorized_missing_token" });
  }

  const result = await verifySupabaseToken(token);
  if (!result.ok) {
    if (result.reason === "unavailable") {
      throw new HTTPException(503, { message: "auth_verifier_unavailable" });
    }
    throw new HTTPException(401, { message: "token_invalid" });
  }

  const { sub: userId, email } = result.payload;

  // Lazily provision / refresh the app-side users projection.
  //
  // PROVISION FOR EVERY AUTHENTICATED USER — keyed on `id`, NOT gated on email. Supabase
  // supports phone-only and anonymous auth, and `users.email` is NULLABLE (backend/001),
  // so an email-less user MUST still get a row (otherwise their items would dangle on a
  // missing FK). `email` is passed as `email ?? null`.
  //
  // avatarUrl + displayName are set on FIRST insert only; the ON CONFLICT set keeps
  // email/updatedAt fresh but intentionally does NOT clobber them, so a user who later
  // uploads/customizes their avatar isn't reset to the default on every login.
  await db
    .insert(users)
    .values({
      id: userId,
      email: email ?? null,
      displayName: resolveDisplayName(result.payload),
      avatarUrl: resolveAvatarUrl(result.payload),
    })
    .onConflictDoUpdate({
      target: users.id,
      set: { email: email ?? null, updatedAt: new Date() },
    });

  c.set("userId", userId);
  c.set("userEmail", email ?? "");

  await next();
});
```

### 6. App wiring — `src/index.ts`

```ts
// src/index.ts — backend/001 created a minimal version of this file (just /health);
// this phase EXTENDS it with cors/logger, the authMiddleware on /api/*, and onError.
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "./types";
import { authMiddleware } from "./auth/middleware";
// DuplicateItemError lives in src/ai/errors.ts, which is created in backend/003. To keep
// THIS phase self-contained (the file must compile before ai/errors exists), backend/002
// ships the onError handler WITHOUT this import and with only the generic branch; when
// backend/003 adds src/ai/errors.ts it also adds this import line + the DuplicateItemError
// branch below. The final shape of onError (shown here) is what the app converges to.
import { DuplicateItemError } from "./ai/errors"; // ADDED IN backend/003

const app = new Hono<AppEnv>();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (origin) => origin, // tighten to the Expo dev/prod origins in production
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  }),
);

// Public health check (no auth).
app.get("/health", (c) => c.json({ ok: true, ts: Date.now() }));

// All /api/* routes require a verified Supabase JWT.
app.use("/api/*", authMiddleware);

// Example protected route proving the context is populated.
app.get("/api/me", (c) =>
  c.json({ userId: c.get("userId"), email: c.get("userEmail") }),
);

// Centralized error rendering.
app.onError((err, c) => {
  // DuplicateItemError (backend/003) is an HTTPException constructed with a custom
  // `res` Response whose body is the structured 409 payload
  // { error:"duplicate_item", message, match:{ id, title, similarity } } that the
  // client's duplicate UI reads. Return that Response VERBATIM via getResponse() —
  // collapsing it to `err.message` (as the generic branch does) would discard the
  // `match` info and the 409 status. Must come BEFORE the generic HTTPException branch.
  if (err instanceof DuplicateItemError) {
    return err.getResponse();
  }
  if (err instanceof HTTPException) {
    // Plain HTTPExceptions (e.g. the 401s thrown by authMiddleware) carry only a
    // message — render the standard JSON shape.
    return c.json({ error: err.message }, err.status);
  }
  console.error("[unhandled]", err);
  return c.json({ error: "Internal Server Error" }, 500);
});

export default app;
```

### 7. Vercel adapter — `api/index.ts`

```ts
// api/index.ts  (Vercel Node serverless entrypoint)
import { handle } from "hono/vercel";
import app from "../src/index";

export const config = { runtime: "nodejs" }; // Node runtime — NOT edge
export default handle(app);
```

`vercel.json` rewrite so all paths hit the Hono app:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/api" }]
}
```

---

## 🚶 Step-by-Step Execution Guide

1. **Install Supabase JS** in the backend package: `pnpm add @supabase/supabase-js`.

2. Add `SUPABASE_URL` and the server-only `SUPABASE_SECRET_KEY` to `.env.local` and
   Vercel. Do not expose the secret key to Expo.

4. **Create the type augmentation** `src/types.ts` (§3). This is what makes
   `c.get("userId")` type-safe everywhere.

5. **Add the verifier** `src/auth/verify-token.ts` (§4). Note it returns a
   discriminated `VerifyResult` rather than throwing — keeps the middleware tidy.

6. **Add the middleware** `src/auth/middleware.ts` (§5). It verifies the token, upserts
   the `users` row **for every authenticated user (email or not)**, and sets context
   vars. The upsert is keyed on `id` and writes `email ?? null` — never gate it on the
   presence of an email.

7. **Wire the app** in `src/index.ts` (§6): mount `authMiddleware` on `/api/*`, add the
   `/api/me` probe and the `onError` handler.

8. **Add the Vercel adapter** `api/index.ts` and `vercel.json` (§7). Confirm
   `runtime: "nodejs"` — the edge runtime cannot open the Postgres TCP socket used by
   `db/client.ts`.

9. **Run locally:** `pnpm dev` (tsx watch). The server listens via Hono's Node
   server; `/health` should respond without a token.

---

## 🧪 Verification & Test Protocols

### A. Health check is public (no token)

```bash
curl -s http://localhost:3000/health
# {"ok":true,"ts":...}
```

### B. Protected route rejects missing token (401)

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/me
# 401
curl -s http://localhost:3000/api/me
# {"error":"Missing or malformed Authorization header"}
```

### C. Protected route rejects garbage token (401)

```bash
curl -s http://localhost:3000/api/me -H "Authorization: Bearer not.a.jwt"
# {"error":"Invalid token"}
```

### D. Protected route accepts a real Supabase token (200)

Mint a token by signing into the Expo app, or via the Supabase JS client in a Node
REPL:

```ts
// get-token.ts — run once with the publishable key + a test user
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_PUBLISHABLE_KEY!,
);
const { data } = await supabase.auth.signInWithPassword({
  email: "test@example.com",
  password: "password123",
});
console.log(data.session?.access_token);
```

Then:

```bash
TOKEN="<paste access_token>"
curl -s http://localhost:3000/api/me -H "Authorization: Bearer $TOKEN"
# {"userId":"<uuid>","email":"test@example.com"}
```

### E. Confirm the `users` row was provisioned

```sql
-- After test D, the projection row should exist.
select id, email, created_at from public.users where email = 'test@example.com';
-- Expect one row whose id equals the JWT `sub`.
```

### E2. Email-less (phone-auth) provisioning

Sign in a **phone-auth** (or anonymous) user — their access token has no `email` claim —
and call `/api/me` once. Then confirm the projection row was still created keyed on `id`:

```sql
-- Replace with the phone-auth user's sub (UUID). The row must exist with email = NULL.
select id, email, display_name from public.users where id = '<phone_user_sub>';
-- Expect: one row, email IS NULL, display_name is NULL unless profile metadata has a name.
```

This proves provisioning is **not** gated on email — email-less users get a row so their
items have a valid `user_id` FK target.

### F. Expired-token path (optional, manual)

Wait for an access token to expire, then repeat test D. Expect the generic invalid-token
response with status 401; provider details must not be exposed.

✅ **Phase complete when:** `/health` is open, `/api/me` returns stable 401 codes for
missing, invalid, and expired tokens, returns retryable
`503 {"error":"auth_verifier_unavailable"}` for Supabase Auth/network outages, and returns 200
with the correct `userId`/`email` for a valid token,
and the `users` projection row is created on first authenticated call **for every
authenticated user — including email-less (phone-auth) users, who get a row with
`email = NULL`**.

---

### ✅ Phase gate (Definition of Done)

Run the shared workspace gate from [`000-conventions-and-tooling.md`](../000-conventions-and-tooling.md) before starting the next phase:

```bash
pnpm gate          # tsc --noEmit (all packages) + biome lint + biome format check
pnpm -r test       # any unit tests added in this phase
```

Both must exit `0`. The same gate runs in CI on every push, and a pre-commit hook runs it on staged files — this is how type-safety and style stay consistent across phases.

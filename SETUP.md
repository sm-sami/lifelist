# Lifelist setup

This guide covers the infrastructure and credentials needed to run Lifelist locally and
deploy it to production. The repository is still greenfield, so commands that depend on
`package.json`, `apps/backend`, or `apps/mobile` become available after phase `000` and
the relevant scaffold phases have landed.

Do not commit passwords, API keys, database URLs, service-role keys, signing credentials,
or `.env.local` files.

## 1. Accounts and access

Create or confirm access to:

- **Supabase** — use the CLI stack locally and one hosted production project.
- **Vercel** — hosts the Hono backend using the Node.js runtime.
- **OpenAI API** — embeddings and item classification. Add billing and a conservative
  project budget before testing.
- **Unsplash Developers** — create an application and obtain an access key.
- **Expo** — Expo Go for normal development. An Expo account is optional until EAS
  services or an installable standalone build are needed.

Recommended ownership:

- Use team-owned projects rather than personal projects for production.
- Require MFA on Supabase, Vercel, OpenAI, Expo, Apple, and Google accounts.
- Keep production access narrower than development access.

## 2. Local prerequisites

Install:

- Git
- Node.js `>=20.19 <27`
- pnpm `10.33.0`
- Supabase CLI
- Docker Desktop, OrbStack, or another Docker-compatible runtime
- Xcode and an iOS Simulator for iOS development (macOS only)
- Android Studio, Android SDK, and an emulator for Android development

After phase `000` is complete:

```bash
pnpm --version   # expect 10.33.0
pnpm install
pnpm gate
pnpm -r test
```

Install pnpm directly, for example with Homebrew followed by
`pnpm self-update 10.33.0`, or another method from pnpm's official installation guide.
Corepack still exists as optional tooling, but this project does not assume it is bundled
with Node or require it.

Use pnpm only. Native Expo dependencies must be installed from `apps/mobile` or with the
mobile workspace filter so Expo selects SDK-compatible versions.

## 3. Supabase environments

Lifelist uses two isolated environments:

| Environment | Purpose |
| --- | --- |
| Local | Supabase CLI containers, local backend, simulators/devices, test data |
| Production | Live personal data and the production backend |

Start the repository's local stack:

```bash
pnpm supabase:start
pnpm supabase:status
```

The first start downloads the container images and can take several minutes. Supabase
Studio is at `http://127.0.0.1:54323`, and captured development email is at
`http://127.0.0.1:54324`. Stop the stack with `pnpm supabase:stop`.

The ignored `apps/backend/.env.local` and `apps/mobile/.env.local` files contain the
generated local credentials. If the local keys change, retrieve the current values with
`supabase status -o env` and update those files.

For production, choose a region close to the Vercel deployment and save the database
password in a password manager. Collect:

- Project URL
- Publishable key (or legacy anon key)
- Service-role key — backend only
- Database password
- Transaction pooler connection string on port `6543`
- Direct database connection string on port `5432`
- JWT signing algorithm
- JWT secret only if the project still uses legacy `HS256`

The backend runtime uses Supavisor transaction mode on port `6543` with prepared
statements disabled. Migrations use the direct connection on port `5432`. If the machine
running migrations cannot reach the direct IPv6 endpoint, use the Supavisor session
pooler on port `5432` for migrations or enable Supabase's IPv4 add-on.

### Supabase configuration

For both local and production:

1. Enable the `vector` extension through a committed migration.
2. Apply committed Drizzle migrations, including RLS policies.
3. Create the private item-image Storage bucket through a committed migration.
4. Apply owner-scoped Storage `SELECT`, `INSERT`, `UPDATE`, and `DELETE` policies.
5. Add `lifelist://**` to Auth redirect URLs if confirmation links, magic links,
   password recovery, or OAuth are enabled.
6. Configure email/password authentication for the initial sign-in implementation.
7. Configure custom SMTP before production email authentication is opened to users.

Do not manually recreate schema or policies in the dashboard if a migration exists.
Dashboard-only changes drift between development and production.

The final plans must use one canonical private Storage bucket name everywhere before its
migration is applied.

## 4. Backend environment

The ignored local file is already configured for the Supabase CLI stack. To recreate it,
copy the committed template and replace its placeholders using `supabase status -o env`:

```bash
cp apps/backend/.env.example apps/backend/.env.local
```

The local Supabase connection has this shape:

```bash
# Supabase database
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
DIRECT_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"

# Supabase API and JWT verification
SUPABASE_URL="http://127.0.0.1:54321"
SUPABASE_SERVICE_ROLE_KEY="<LOCAL_SERVICE_ROLE_KEY>"
SUPABASE_JWT_ALG="HS256"
SUPABASE_JWT_SECRET="<LOCAL_JWT_SECRET>"

# OpenAI
OPENAI_API_KEY="<SERVER_ONLY_OPENAI_KEY>"
EMBEDDING_MODEL="text-embedding-3-small"
DEDUP_DISTANCE_MAX="0.15"
OPENAI_CLASSIFY_MODEL="gpt-4o-mini"

# Unsplash
UNSPLASH_ACCESS_KEY="<SERVER_ONLY_UNSPLASH_ACCESS_KEY>"

# Headout
HEADOUT_SEARCH_BASE="https://search.headout.com"
HEADOUT_SEARCH_PATH="/api/v3/search/"
HEADOUT_CURRENCY="USD"
HEADOUT_LANGUAGE="en"

# Local server
PORT="3000"
NODE_ENV="development"
```

Load the file for migration commands when required:

```bash
cd apps/backend
set -a
source .env.local
set +a
pnpm db:migrate
```

Never put `SUPABASE_SERVICE_ROLE_KEY`, database URLs, OpenAI keys, or Unsplash keys in
Expo config or any `EXPO_PUBLIC_*` variable.

## 5. Mobile local configuration

The mobile app needs only public client configuration:

| Setting | Development value |
| --- | --- |
| `supabaseUrl` | Local Supabase API URL |
| `supabaseAnonKey` | Local publishable/anon client key |
| `apiBaseUrl` | Local backend URL ending in `/api` |

The ignored local file is already configured. To recreate it, copy the committed
template and use `supabase status -o env`:

```bash
cp apps/mobile/.env.example apps/mobile/.env.local
```

The mobile variables are:

```bash
EXPO_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"
EXPO_PUBLIC_SUPABASE_ANON_KEY="<LOCAL_PUBLISHABLE_KEY>"
EXPO_PUBLIC_API_BASE_URL="http://127.0.0.1:3000/api"
```

`app.config.ts` maps these public variables into Expo `extra.supabaseUrl`,
`extra.supabaseAnonKey`, and `extra.apiBaseUrl`, which are the names consumed by the
planned client code. Environment-specific values stay out of committed app config.

Choose the local API URL by runtime:

| Runtime | Example |
| --- | --- |
| iOS Simulator | `http://127.0.0.1:3000/api` |
| Android Emulator | `http://10.0.2.2:3000/api` |
| Physical device | `http://<YOUR_LAN_IP>:3000/api` |

For a physical device, the phone and computer must be on the same network and the local
firewall must allow the backend port. Do not use `localhost` from a physical device—it
refers to the phone itself.

The app URL scheme is `lifelist`. Keep the iOS bundle identifier and Android application
ID stable if a standalone build is ever created.

### Fonts

Halyard is proprietary. Do not copy or bundle it unless redistribution rights for this
app are confirmed in writing. The default local and production build should use the
license-clean Sora/Hanken Grotesk fallback.

## 6. Run locally with Expo Go

Expo Go is the preferred zero-build development path where the installed Expo Go version
matches the project's SDK. The planned stack—including Expo Router, Reanimated, Gesture
Handler, image picking, Supabase, bottom sheets, and Skia—is suitable for Expo Go.

Lifelist is pinned to Expo SDK 56 so it runs in the current Expo Go on Android, iOS
Simulator, and a physical iPhone.

Expo Go is enough for:

- Building and testing the screens and navigation
- Supabase authentication, Storage, and Realtime
- Calling the local or deployed Hono backend
- Reanimated gestures and bottom sheets
- The Skia celebration canvas
- Image-library picking and uploads
- Runtime-loaded Sora/Hanken Grotesk fonts

Expo Go does not validate the final native application binary. Use a development or
standalone build only if you later need:

- A native dependency that Expo Go does not include
- A custom config plugin or native project change
- The real app icon, splash screen, application ID, or native permissions
- The `lifelist://` custom scheme exactly as it behaves in an installed standalone app
- A privately installable app that runs without the Expo Go client and local dev server

The current stack does not require a development build merely because it uses
Reanimated or Skia; both are included in Expo Go for SDK 56.

Once the relevant phases exist:

Terminal 1:

```bash
cd apps/backend
set -a
source .env.local
set +a
pnpm dev
```

Verify:

```bash
curl http://localhost:3000/health
```

Terminal 2:

```bash
pnpm --filter mobile expo start
```

Install an Expo Go version matching the project SDK, then scan the QR code. The device
and development computer should normally be on the same network. If LAN discovery is
blocked, start Expo with a tunnel:

```bash
pnpm --filter mobile expo start --tunnel
```

The app can use a deployed development backend from Expo Go. For a backend running on
the development computer, use the computer's LAN address in `apiBaseUrl`; never use
`localhost` from a physical phone.

Before calling local setup complete, verify:

- Backend health check responds.
- The app signs in against the local Supabase stack.
- A protected Hono endpoint accepts the Supabase access token.
- Migrations have enabled RLS and direct client writes outside the allowed policies fail.
- An item can be created, enriched, completed, and reloaded.
- A user-uploaded image is private and readable only through the intended signed-URL
  flow.
- Signing out and switching accounts clears cached user data.
- `pnpm gate` and `pnpm -r test` both pass.

## 7. Production backend on Vercel

Create a Vercel project for the backend:

- Set the root directory to `apps/backend`.
- Use the Node.js runtime, not Edge—the backend opens PostgreSQL TCP connections.
- Connect the production branch.
- Choose a deployment region near the production Supabase project.
- Add a custom API domain if desired, for example `api.example.com`.

Add the production backend variables to Vercel Production. Do not point Vercel
Development or Preview deployments at production unless that risk has been explicitly
accepted; local development uses the CLI stack.

Do not run migrations automatically inside a serverless request. Apply committed
migrations as an explicit release/CI step using `DIRECT_URL`, then deploy application
code.

Recommended release order:

1. Back up or confirm point-in-time recovery as appropriate.
2. Run the gate and tests.
3. Apply backward-compatible database migrations.
4. Deploy the backend.
5. Run health, authentication, create-item, storage, and authorization smoke tests.
6. Verify the mobile client in Expo Go after its required backend contract is live.

Set OpenAI usage limits and alerts before production traffic. Configure Vercel and
Supabase logs/alerts, and never log access tokens, service-role keys, database URLs,
image signed URLs, or complete third-party payloads containing user data.

## 8. Mobile use without app stores

No Apple App Store or Google Play publishing setup is required.

For development, run the app through a matching Expo Go build where supported. It loads
the JavaScript bundle from the Expo development server, so that server must be running
and reachable.

If Expo Go or simulators remain sufficient, EAS, signing credentials, Apple Developer
membership, Google Play Console access, store records, screenshots, and store metadata
are not part of this project's setup.

If a permanently installable standalone app is wanted later, that is a separate,
optional distribution decision:

- Android can use a privately distributed APK.
- A physical iOS standalone installation still requires Apple signing/provisioning even
  when the app is not published in the App Store.

Any mobile environment configuration contains only:

- Production Supabase URL
- Production publishable/anon key
- Production API base URL

Test the production backend and Supabase project carefully before pointing Expo Go at
them. Use the local CLI configuration during ordinary work so test data and mistakes
cannot affect production data.

## 9. Production readiness checklist

- [x] Local Supabase CLI environment separated from production
- [ ] Production database password and keys stored in a team password manager
- [ ] RLS enabled and negative authorization tests passing
- [ ] Private Storage bucket and owner policies applied by migration
- [ ] Production migrations rehearsed against development or staging
- [ ] Vercel production environment variables configured
- [ ] No server secret present in the Expo bundle
- [ ] OpenAI budget limits and alerts configured
- [ ] Unsplash attribution and download-trigger requirements verified
- [ ] Headout live GET contract smoke-tested during release
- [ ] Production Auth email delivery and redirect links tested
- [ ] Backups, logging, alerting, and rollback procedure documented
- [ ] `pnpm gate` and `pnpm -r test` green

## References

- [Supabase database connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase native mobile deep linking](https://supabase.com/docs/guides/auth/native-mobile-deep-linking)
- [Vercel environment variables](https://vercel.com/docs/environment-variables)
- [Expo development environment and Expo Go](https://docs.expo.dev/get-started/set-up-your-environment/)
- [Expo Go versus development builds](https://docs.expo.dev/develop/development-builds/introduction/)
- [Expo SDK 56 Skia](https://docs.expo.dev/versions/v56.0.0/sdk/skia/)
- [Expo SDK 56 Reanimated](https://docs.expo.dev/versions/v56.0.0/sdk/reanimated/)
- [pnpm installation](https://pnpm.io/installation)
- [Node.js Corepack status](https://nodejs.org/download/release/latest/docs/api/corepack.html)

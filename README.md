# WhatNext API

Standalone backend for the WhatNext Expo app: Express, Prisma and SQLite. API routes use `/api`; uploaded images use `/media`. The API and worker share one database and upload directory. Docker is optional.

## Local setup

Use Node 22 LTS. From this repository:

```sh
npm ci
cp .env.example .env
```

Copy the example only when `.env` does not already exist. Configure `DATABASE_URL`, a private `JWT_SECRET`, and `TMDB_KEY`. Relative SQLite paths resolve inside `prisma/`. Never put these secrets in the frontend or commit them.

For a new database:

```sh
npm run db:setup
npm run catalog:sync
npm run dev:all
```

`db:setup` backs up existing SQLite data and uploads, applies migrations, initializes missing reference definitions and restores owned image references. It preserves existing accounts, reviews and customized reward definitions. Run it with API and worker stopped. `db:seed` only initializes missing rewards, achievements and ranks; it is non-destructive. `catalog:sync` imports real movies and saved release lists from TMDB.

`dev:all` keeps the API and worker running. Alternatively, run `npm run dev` and `npm run worker` in separate terminals. Start Expo separately from the frontend repository:

```sh
npx expo start --go
```

For local testing on the same computer/network, the frontend's automatic Expo-host detection still reaches port 3000. For another host, set its `EXPO_PUBLIC_API_URL=http://SERVER_IP:3000/api`. The phone must reach that address. Restart Expo after changing frontend environment settings. Expo's tunnel does not expose the backend.

**Upgrading an existing database:** use `npm run db:setup` to back up and apply the versioned migrations. Do not replace an existing database with a seed or run both backends against it during migration.

## Structure

| Location | Purpose |
|---|---|
| `src/index.ts` | Express startup, shared middleware, route registration, health check |
| `src/routes/` | HTTP endpoints, request validation and permissions |
| `src/middlewares/` | Revocable session checks, roles, error handling |
| `src/services/` | Movie queries, calculations, points, vouchers, push, uploads, Wallet and external providers |
| `src/worker.ts` | Daily TMDB schedule and minute-by-minute release and social push processing |
| `src/jobs/sync-catalog.ts` | One-time catalog import command |
| `prisma/schema.prisma` | Database models and relationships |
| `prisma/migrations/` | Versioned SQL upgrades; existing history is retained |
| `prisma/reference*.ts` | Non-destructive initialization of reference definitions |
| `scripts/` | Database setup, backups, image/points migration and administrator creation |
| `uploads/` | Private-to-the-server persistent image files, publicly served by UUID URL |
| `assets/wallet/` | Bundled Wallet artwork |
| `tests/` | Isolated database/API/provider fixtures and real upgrade tests |
| `deploy/` | Optional single-server Docker Compose, HTTPS and issuer setup instructions |

See [ARCHITECTURE.md](ARCHITECTURE.md) for startup, request flow, calculations, push delivery and the function map.

## Functionality

- Credential-checked signup/login, seven-day JWTs backed by revocable sessions, logout and role checks.
- Movie catalog, search, recommendations, community/friend ratings, administration, stored TMDB metadata and release lists.
- Reviews, likes, reposts, friendships, profiles and in-app social notifications.
- Database-backed reward/achievement/rank definitions; permanent awards and an authoritative points ledger. The imported implementation can reconcile missing awards during achievement/reward reads.
- Atomic reward spending, single-use codes, staff fulfillment, administrator refunds and owner cancellation that verifies the original debit and invalidates the code before returning points.
- Saved release subscriptions, session-bound push devices, persistent delivery queue, retries and provider receipts.
- Decoded/resized WebP uploads with ownership records, plus migration of old JPEG/PNG/WebP references.
- Nearby cinema searches with backend distances, cache, provider fallback and labeled stale results.
- Apple signed coupon passes and Google Wallet save links for the existing reward code, when issuer credentials are configured.

## Schedules

The worker reads `TMDB_CRON` at startup. Default: `0 4 * * *`, daily at 04:00 in `America/Argentina/Buenos_Aires`. Change `.env` and restart the worker to change the time. Run `npm run catalog:sync` whenever an immediate update is needed. Movie creation/update happens in `importMovieFromTmdb()` in `src/services/tmdb.ts`, using `movie.upsert` by TMDB ID.

The worker also checks release and social push deliveries every minute. API and worker must remain running on an awake host. Push requires a physical device, a development/production app build and Expo/EAS platform credentials. Expo Go cannot test this remote delivery implementation. Wallet requires Apple/Google issuer credentials. Adding credentials is still required; moving the code does not create accounts or enable delivery automatically.

Saved Wallet passes do not automatically change appearance after use/cancellation/refund; online code validation is authoritative. Delivery receipts indicate provider acceptance rather than proof that a person saw a notification.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | API watcher, port 3000 |
| `npm run worker` | Catalog/push scheduler |
| `npm run dev:all` | API and worker together |
| `npm run db:setup` | Generate client, back up existing database, apply migrations, initialize reference data |
| `npm run db:studio` | Browse the database; keep the terminal process running |
| `npm run catalog:sync` | Import/update TMDB movies and release snapshots now |
| `npm run db:backup` | Consistent SQLite snapshot and uploaded-file copy |
| `npm run media:migrate` | Back up, then migrate legacy images into owned WebP uploads |
| `npm run points:migrate` | Initialize/reconcile missing legacy points records idempotently |
| `npm run admin:create` | Create first superadmin using private `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` variables |
| `npm run typecheck` / `npm test` | Type checks and isolated automated tests |
| `npm run build` | Compile API and worker into `dist/` |
| `npm start` / `npm run worker:start` | Run compiled production API/worker |

`npm ci` may require a subsequent `npm run db:setup` or `npx prisma generate` to regenerate the Prisma client before type checks/builds. Tests use temporary databases and mocked external providers; they do not send real phone notifications or issue production Wallet passes.

## Deployment

See [deploy/README.md](deploy/README.md) and [deploy/WALLET.md](deploy/WALLET.md). SQLite and uploaded files must be persistent and backed up separately from Git. Keep API and worker on the same host/shared storage. Do not run the seed from the older frontend repository: its demo seed is a different operation.

Use `npm test` for the maintained regression suite. Wallet signature tests require OpenSSL (available through Git for Windows, the system PATH, or `OPENSSL_BIN`).

## Social push delivery

Friend requests, review likes and review reposts now use the same backend-owned queue, worker, Expo transport, retries and receipts as release reminders. The API creates `Notification` and `PushDelivery` in the same transaction as the social action; it never waits on Expo to complete the request. Payloads and recipients are selected by the server. `PushDelivery.kind` distinguishes `release-reminder` and `social-notification`; existing release rows migrate without losing their state.

The minute worker sends pending social events without waiting for 10:00. Read notifications, withdrawn/answered requests, removed reactions, deleted reviews, hidden movies, logout/expired sessions and switched accounts are rechecked before sending. Notifications already accepted by a provider cannot be recalled. Social messages expire after 24 hours, only target devices registered at event time, and repeated actor/action/subject/device combinations are limited to one per Buenos Aires calendar day. No historical social notifications are backfilled by the migration.

Android uses the `actividad` channel for social notifications and `estrenos` for releases. Notification taps open the requester profile or the reviewed movie. The frontend still requests permission, obtains the Expo token and handles taps; it does not schedule or send social pushes.

Apply the migration with `npm run db:setup` with the API/worker stopped, then restart them. Real delivery still requires the EAS app identifiers, APNs/FCM credentials and an installed development/production build.

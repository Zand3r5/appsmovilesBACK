# Running WhatNext on a server

This setup targets one Linux host with Docker Compose, a persistent volume shared by the API and worker, and a domain pointing at that host. SQLite does not support this layout across multiple hosts. The files are prepared; no server has been deployed and the containers have not been run in the development environment because Docker is unavailable there.

## Configure and start

1. Copy `.env.production.example` to `.env.production`, and `deploy/.env.example` to `deploy/.env`.
2. Set `API_DOMAIN` to your real DNS name. Open inbound ports 80 and 443. Caddy obtains HTTPS certificates.
3. Set a random `JWT_SECRET` of at least 32 characters, `TMDB_KEY`, and the real browser origin in `CORS_ORIGINS`. Keep `/data` database/upload/backup paths. Set `EXPO_ACCESS_TOKEN` if enhanced Expo push security is enabled. Never put these server secrets in Expo public variables.
4. From `deploy/`, run:

```sh
docker compose up -d --build
docker compose exec api npm run catalog:sync
docker compose ps
docker compose logs --tail=100 api worker
```

The migration service runs before the API and worker. The worker refreshes TMDB daily at 04:00 Buenos Aires time and checks release and social pushes every minute. Keep it running even if you move TMDB synchronization to an external scheduler. Configure uptime monitoring for `/api/health` and worker container health. A heartbeat proves the worker process is alive; monitor failed deliveries and catalog freshness separately.

For a fresh database, create the first administrator interactively without putting a password in command history:

```sh
docker compose exec api bash
read -r ADMIN_EMAIL
read -r ADMIN_NAME
read -rs ADMIN_PASSWORD
export ADMIN_EMAIL ADMIN_NAME ADMIN_PASSWORD
npm run admin:create
exit
```

The command refuses to replace an existing administrator or promote an existing email. The reference-data seed is non-destructive and preserves existing definitions. Set the app's `EXPO_PUBLIC_API_URL` to `https://YOUR_DOMAIN/api` and rebuild/restart the app.

## Backups and upgrades

Before an upgrade, run `docker compose exec api npm run db:backup`. It creates a consistent SQLite snapshot and copies uploaded images into a timestamped folder under `/data/backups`. Copy backups off the host, restrict their access, and schedule this command with your hosting platform or host scheduler. No backup schedule or off-host storage is provisioned by this repository. Upload copying is separate from the database snapshot; pause writes if a fully coordinated restore point is required.

To restore, stop API and worker, preserve the current volume, restore the snapshot database as `/data/whatnext.db` and its `uploads` folder as `/data/uploads`, ensure both belong to the container's node user, then run migrations and start services. Validate restore on a separate volume first. Keep backup retention and restore testing in your operating process.

Use `npm run media:migrate` inside the API container to convert legacy embedded images; it makes a backup first. Deploy upgrades with `docker compose up -d --build`, then check container health, the catalog timestamp, authentication and a saved image.

## Real mobile push setup

Follow the official [Expo push setup](https://docs.expo.dev/push-notifications/push-notifications-setup/) and [delivery guidance](https://docs.expo.dev/push-notifications/sending-notifications/).

1. Link this application to your EAS project. Supply its actual UUID as `EXPO_PUBLIC_EAS_PROJECT_ID`, and choose your Android package/iOS bundle identifier using the corresponding variables in the frontend `.env.example`.
2. Configure Android FCM v1 and/or Apple APNs credentials in that project. Configure any required platform files through your EAS setup; keep credentials private.
3. Build the `development` EAS profile for your platform, install it on a physical phone, and start the Expo development server for that build. Expo Go and the browser do not receive these remote notifications.
4. Log in, grant notifications, and subscribe to an upcoming movie. Confirm a device is registered and the subscription exists in the backend. Opening an account on another device requires that device to register too.
5. In an isolated staging database, set a test movie's release to today's Buenos Aires date. Subscribe before 10:00 and verify arrival after 10:00 with the app closed. Confirm a tap opens the movie, verify the saved ticket and receipt, and confirm subsequent worker ticks do not enqueue another delivery. Use staging rather than changing production catalog dates for tests.
6. Check permission denial, logout, account switching, cancellation, expired sessions and an invalid token. Logout revokes that installation's session/device registration; it preserves subscriptions for future sessions. Alerts can be delayed or suppressed by the operating system, and an already accepted push cannot be recalled.

Tickets and receipts are persisted in `PushDelivery`. Receipt success means handoff to the platform provider, not display on a phone. Temporary failures retry with backoff; invalid tokens are disabled. Queue creation is unique per account/device/movie/date. Delivery is at least once: a worker crash after remote acceptance can produce a duplicate. Notifications cover release reminders, incoming friend requests, review likes and review reposts.

## Checks still requiring a real environment

- Build/start the containers, check TLS and persistent volumes, and rehearse restore.
- Supply EAS identifiers and credentials, then test Android/iOS delivery on physical devices.
- Verify a working Overpass provider for the intended traffic. Public endpoints failed live checks in development; deterministic caching/fallback tests passed. Configure `OVERPASS_URL` for a dedicated provider if needed.
- Run the application flows against the deployed API, including login/session restoration, reviews, images, reward fulfillment, scheduled TMDB imports and push receipts.

## Points migration and reward Wallets

After deploying the points-ledger migration, run `docker compose exec api npm run points:migrate` to initialize existing accounts. It preserves currently earned achievements and imports prior redemption/refund entries without duplicating them. Configure and test Apple Wallet and Google Wallet separately using [WALLET.md](WALLET.md). Both providers require real issuer credentials; no issuer account or certificate is provisioned by deployment.

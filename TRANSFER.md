# Transfer from the frontend repository

This change restores the complete backend in `Zand3r5/appsmovilesBACK` while retaining its migration history and database-backed reference catalogs. The frontend continues using the same `/api` contracts. No production database or secret is shipped in this change.

## 1. Keep a rollback copy

Stop the old API and worker before the final database copy. Stop any API using the destination database too. Do not delete `aplicaciones-moviles-2026/backend` yet.

From the original backend, `npm run db:backup` produces a SQLite snapshot plus uploaded images. Copy the entire backup folder somewhere private outside both repositories. Also preserve `.env` and any private issuer credential files separately. The database and images are not transferred by Git. Never use the tracked historical `prisma/dev.db` as the live database.

The snapshot command gives a consistent database; stopping writes also coordinates its image-file copy. Keep the original application data unchanged for rollback.

## 2. Prepare this repository

Use Node 22 and run `npm ci`. Create `.env` only if absent. Copy the required private configuration from the old backend, adjusting absolute paths for the new folder. Relative `file:./local.db` means this repository's `prisma/local.db`. Preserve a strong private `JWT_SECRET`; old sessions will nevertheless need a fresh login after the database upgrade.

Choose exactly one authoritative source database: the current frontend backend's snapshot, or a database already used by this separate backend. Do not combine or overwrite two databases containing independent accounts. Combining independent databases requires a separate identity/data merge.

For a rehearsal, copy the snapshot to a new filename and point `DATABASE_URL` there. Copy its matching uploads into a new directory and set `UPLOAD_DIR` accordingly. Do not point the restored API at the original files.

## 3. Upgrade the copy

With API and worker stopped:

```sh
npm run db:setup
npm run media:migrate
npm run points:migrate
npm run catalog:sync
```

Use `db:setup`, not a schema reset or demo seed. The previous migrations are unchanged. A new restoration migration reintroduces sessions, push devices/deliveries, upload ownership, job locks, sync history and cinema cache.

The simplified backend discarded the points ledger's event keys. The restoration keeps all old entries/IDs/amounts as `legacy:*` history, reconstructs unique award/debit/refund entries from saved awards and vouchers, and inserts one opening adjustment per account. This preserves the exact cached balance instead of doubling the reconstructed credits. Previously canceled/refunded vouchers receive a matching refund identity and cannot be credited again. Already-awarded point amounts and original voucher costs remain frozen even if reference prices changed.

`points:migrate` can additionally award currently qualifying but previously unrecorded activity. Such new awards can increase balances; the schema migration itself preserves the prior balance exactly. Review the ledger and balances in the rehearsal before final cutover.

The historical simplification migration drops sessions and other operational tables if upgrading directly from the original backend's older schema. Those operational records are not preserved through that historical chain: accounts/reviews/vouchers remain, but users must log in again, devices must register again, and operational history is rebuilt. The current target database has already removed those tables. The old files and original database remain available in the rollback copy.

`media:migrate` backs up first, processes only images referenced in saved reviews/movies, copies them into decoded WebP files with ownership records, and updates the references. Original files are retained. It handles images shared across legacy accounts by creating separate owned files. Missing or invalid referenced files cause an error that must be fixed before cutover; it does not silently discard photos.

## 4. Run and verify

```sh
npm run typecheck
npm run build
npm test
npm run dev:all
```

In the frontend repository, run `npx expo start --go`. Keep its `EXPO_PUBLIC_API_URL` empty for local Expo-host detection, or set it to the reachable backend's `/api` URL if hosted elsewhere. Test login, existing reviews/photos, release lists, points, redemption/cancellation and staff code validation.

There must be only one backend listening on port 3000. The old frontend `npm run dev` / `npm run backend` still launch its bundled backend; use Expo alone while this repository runs `dev:all`. Once the rehearsal is accepted, repeat the backup/copy/upgrade with writes stopped and the latest data, and switch the frontend's normal launcher scripts. Remove the bundled backend in a later reviewed cleanup after rollback is no longer needed.

## 5. Publish and configure real services

Merge the restoration branch into this backend repository after review and deploy this repository's version, API plus worker. Optional Docker files now live in `deploy/` here and use this repository as their build context. Docker is not required for local development or a server supervised with Node.

Set the hosted app's `EXPO_PUBLIC_API_URL` to the real HTTPS API URL. Configure persistent SQLite/uploads storage, backups, TLS and monitoring. Supply Expo/EAS credentials and a phone development/production build for remote pushes, and Apple/Google issuer credentials for Wallet. Those account setups remain external prerequisites.

The transfer tests rehearse upgrading the previous schema, preserving custom reward prices and cached balances (including a negative balance), cancellation retries, rollback on failed credits, legacy photos and rerunning migration without extra credits. Tests also exercise signed Wallet fixtures and mocked push delivery; they do not prove production issuer/phone delivery.

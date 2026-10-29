-- Preserve the simplified backend's authoritative balances before removing User.points.
CREATE TABLE "_TransferBalance" AS SELECT "id" AS "userId", "points" AS "balance" FROM "User";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" INTEGER NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'running',
    "imported" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT
);

-- CreateTable
CREATE TABLE "JobLock" (
    "name" TEXT NOT NULL PRIMARY KEY,
    "owner" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CinemaLookup" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "data" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PushDevice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "secretHash" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "sessionId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PushDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PushDevice_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PushDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" INTEGER NOT NULL,
    "movieId" INTEGER NOT NULL,
    "deviceId" TEXT,
    "releaseDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ticketId" TEXT,
    "receiptCheckedAt" DATETIME,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PushDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PushDelivery_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "Movie" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PushDelivery_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "PushDevice" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pointsInitializedAt" DATETIME
);
INSERT INTO "new_User" ("createdAt", "email", "id", "name", "passwordHash", "role") SELECT "createdAt", "email", "id", "name", "passwordHash", "role" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE TABLE "new_PointEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PointEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- Retain every original entry and amount as imported history. The simplified
-- ledger discarded event identities, so do not guess which row was which event.
INSERT INTO "new_PointEntry" ("amount", "createdAt", "description", "id", "kind", "userId", "key")
SELECT "amount", "createdAt", "description", "id", 'legacy:' || "kind", "userId", 'legacy:' || "id" FROM "PointEntry";
DROP TABLE "PointEntry";
ALTER TABLE "new_PointEntry" RENAME TO "PointEntry";
CREATE INDEX "PointEntry_userId_id_idx" ON "PointEntry"("userId", "id");
CREATE UNIQUE INDEX "PointEntry_userId_key_key" ON "PointEntry"("userId", "key");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "CinemaLookup_expiresAt_idx" ON "CinemaLookup"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushDevice_token_key" ON "PushDevice"("token");

-- CreateIndex
CREATE INDEX "PushDevice_userId_enabled_idx" ON "PushDevice"("userId", "enabled");

-- CreateIndex
CREATE INDEX "PushDelivery_status_nextAttemptAt_idx" ON "PushDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "Upload_filename_key" ON "Upload"("filename");

-- CreateIndex
CREATE INDEX "Upload_ownerId_idx" ON "Upload"("ownerId");

-- Rebuild canonical event identities from the durable awards and vouchers.
-- These identities prevent repeat credits and allow refunds to verify the debit.
INSERT INTO "PointEntry" ("userId", "key", "kind", "amount", "description", "createdAt")
SELECT "userId", 'achievement:' || "achievementId", 'achievement', "points", 'Logro importado: ' || "achievementId", "awardedAt" FROM "AchievementAward";
INSERT INTO "PointEntry" ("userId", "key", "kind", "amount", "description", "createdAt")
SELECT "userId", 'redemption:' || "id", 'redemption', -"cost", 'Canje importado: ' || "rewardId", "createdAt" FROM "Redemption";
INSERT INTO "PointEntry" ("userId", "key", "kind", "amount", "description", "createdAt")
SELECT "userId", 'refund:' || "id", 'refund', "cost", 'Reintegro importado: ' || "rewardId", "refundedAt" FROM "Redemption" WHERE "refundedAt" IS NOT NULL;
-- Imported history and reconstructed events overlap. Reconcile once to the exact
-- pre-upgrade balance, including manual adjustments and incomplete old ledgers.
INSERT INTO "PointEntry" ("userId", "key", "kind", "amount", "description")
SELECT "userId", 'migration:balance', 'migration', "balance" - COALESCE((SELECT SUM("amount") FROM "PointEntry" WHERE "PointEntry"."userId" = "_TransferBalance"."userId"), 0),
'Ajuste de apertura: conserva el saldo anterior sin duplicar puntos' FROM "_TransferBalance";
UPDATE "User" SET "pointsInitializedAt" = CURRENT_TIMESTAMP;
DROP TABLE "_TransferBalance";

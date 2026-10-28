INSERT OR IGNORE INTO "PointEntry" ("userId","key","kind","amount","description","createdAt") SELECT "userId", 'redemption:' || "id", 'redemption', -"cost", 'Canje anterior: ' || "rewardId", "createdAt" FROM "Redemption";
INSERT OR IGNORE INTO "PointEntry" ("userId","key","kind","amount","description","createdAt") SELECT "userId", 'refund:' || "id", 'refund', "cost", 'Reintegro anterior: ' || "rewardId", "refundedAt" FROM "Redemption" WHERE "refundedAt" IS NOT NULL;
INSERT OR IGNORE INTO "PointEntry" ("userId","key","kind","amount","description","createdAt") SELECT "userId", 'achievement:' || "achievementId", 'achievement', "points", 'Logro anterior: ' || "achievementId", "awardedAt" FROM "AchievementAward";
-- DropIndex
DROP INDEX "Session_userId_idx";

-- DropIndex
DROP INDEX "CinemaLookup_expiresAt_idx";

-- DropIndex
DROP INDEX "PushDevice_token_key";

-- DropIndex
DROP INDEX "PushDevice_userId_enabled_idx";

-- DropIndex
DROP INDEX "PushDelivery_status_nextAttemptAt_idx";

-- DropIndex
DROP INDEX "Upload_filename_key";

-- DropIndex
DROP INDEX "Upload_ownerId_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Session";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "SyncRun";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "JobLock";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "CinemaLookup";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "PushDevice";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "PushDelivery";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Upload";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "points" INTEGER NOT NULL DEFAULT 0,
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("createdAt", "email", "id", "name", "passwordHash", "role") SELECT "createdAt", "email", "id", "name", "passwordHash", "role" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE TABLE "new_PointEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PointEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PointEntry" ("amount", "createdAt", "description", "id", "kind", "userId") SELECT "amount", "createdAt", "description", "id", "kind", "userId" FROM "PointEntry";
DROP TABLE "PointEntry";
ALTER TABLE "new_PointEntry" RENAME TO "PointEntry";
CREATE INDEX "PointEntry_userId_id_idx" ON "PointEntry"("userId", "id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


UPDATE "User" SET "points" = COALESCE((SELECT SUM("amount") FROM "PointEntry" WHERE "userId" = "User"."id"), 0);

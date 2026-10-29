-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PushDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" INTEGER NOT NULL,
    "movieId" INTEGER,
    "kind" TEXT NOT NULL DEFAULT 'release-reminder',
    "notificationId" INTEGER,
    "deviceId" TEXT,
    "releaseDate" TEXT,
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
    CONSTRAINT "PushDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PushDelivery_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "PushDevice" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PushDelivery" ("attempts", "createdAt", "deviceId", "error", "id", "movieId", "nextAttemptAt", "receiptCheckedAt", "releaseDate", "status", "ticketId", "updatedAt", "userId") SELECT "attempts", "createdAt", "deviceId", "error", "id", "movieId", "nextAttemptAt", "receiptCheckedAt", "releaseDate", "status", "ticketId", "updatedAt", "userId" FROM "PushDelivery";
DROP TABLE "PushDelivery";
ALTER TABLE "new_PushDelivery" RENAME TO "PushDelivery";
CREATE INDEX "PushDelivery_status_nextAttemptAt_idx" ON "PushDelivery"("status", "nextAttemptAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

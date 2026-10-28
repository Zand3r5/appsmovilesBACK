-- AlterTable
ALTER TABLE "User" ADD COLUMN "pointsInitializedAt" DATETIME;

-- CreateTable
CREATE TABLE "AchievementAward" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "achievementId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "awardedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AchievementAward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PointEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PointEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AchievementAward_userId_achievementId_key" ON "AchievementAward"("userId", "achievementId");

-- CreateIndex
CREATE INDEX "PointEntry_userId_id_idx" ON "PointEntry"("userId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PointEntry_userId_key_key" ON "PointEntry"("userId", "key");


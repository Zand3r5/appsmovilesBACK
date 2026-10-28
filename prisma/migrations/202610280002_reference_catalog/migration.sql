-- CreateTable
CREATE TABLE "Reward" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "cost" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "Achievement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "stat" TEXT NOT NULL,
    "goal" INTEGER NOT NULL,
    "points" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "Rank" (
    "min" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL
);

INSERT INTO "Reward" ("id","title","description","icon","cost") VALUES ('popcorn','Pochoclos medianos','En cines adheridos','fast-food-outline',30);
INSERT INTO "Reward" ("id","title","description","icon","cost") VALUES ('two_for_one','2x1 en entradas','Válido de lunes a jueves','ticket-outline',60);
INSERT INTO "Reward" ("id","title","description","icon","cost") VALUES ('presale','Preventa anticipada','Acceso 24 h antes a preventas','time-outline',100);
INSERT INTO "Reward" ("id","title","description","icon","cost") VALUES ('free_ticket','Entrada gratis','Una función 2D a elección','film-outline',150);
INSERT INTO "Achievement" ("id","title","description","icon","stat","goal","points") VALUES ('first_review','Primera reseña','Publicá tu primera reseña','create-outline','totalReviews',1,10);
INSERT INTO "Achievement" ("id","title","description","icon","stat","goal","points") VALUES ('active_critic','Crítico en marcha','Publicá 5 reseñas','chatbubbles-outline','totalReviews',5,20);
INSERT INTO "Achievement" ("id","title","description","icon","stat","goal","points") VALUES ('expert_critic','Crítico experto','Publicá 15 reseñas','ribbon-outline','totalReviews',15,30);
INSERT INTO "Achievement" ("id","title","description","icon","stat","goal","points") VALUES ('viral_review','Reseña viral','Conseguí 100 likes o más en una sola reseña','flame-outline','maxLikesOnReview',100,50);
INSERT INTO "Achievement" ("id","title","description","icon","stat","goal","points") VALUES ('genre_explorer','Explorador de géneros','Reseñá películas de 3 géneros distintos','compass-outline','distinctGenres',3,10);
INSERT INTO "Achievement" ("id","title","description","icon","stat","goal","points") VALUES ('star_rater','Todo estrellas','Calificá con estrellas 5 películas','star-outline','totalRatings',5,15);
INSERT INTO "Achievement" ("id","title","description","icon","stat","goal","points") VALUES ('cinema_photo','Fui al cine','Subí una reseña con foto','camera-outline','totalPhotos',1,20);
INSERT INTO "Rank" ("min","name","icon") VALUES (5,'Espectador','eye');
INSERT INTO "Rank" ("min","name","icon") VALUES (25,'Cinéfilo','film');
INSERT INTO "Rank" ("min","name","icon") VALUES (50,'Crítico','chatbubble-ellipses');
INSERT INTO "Rank" ("min","name","icon") VALUES (100,'Director','videocam');
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Redemption" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "rewardId" TEXT NOT NULL,
    "cost" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "usedById" INTEGER,
    "refundedById" INTEGER,
    "refundedAt" DATETIME,
    CONSTRAINT "Redemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Redemption_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "Reward" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Redemption" ("code", "cost", "createdAt", "expiresAt", "id", "refundedAt", "refundedById", "rewardId", "status", "usedAt", "usedById", "userId") SELECT "code", "cost", "createdAt", "expiresAt", "id", "refundedAt", "refundedById", "rewardId", "status", "usedAt", "usedById", "userId" FROM "Redemption";
DROP TABLE "Redemption";
ALTER TABLE "new_Redemption" RENAME TO "Redemption";
CREATE UNIQUE INDEX "Redemption_code_key" ON "Redemption"("code");
CREATE INDEX "Redemption_userId_status_idx" ON "Redemption"("userId", "status");
CREATE TABLE "new_AchievementAward" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "achievementId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "awardedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AchievementAward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AchievementAward_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_AchievementAward" ("achievementId", "awardedAt", "id", "points", "userId") SELECT "achievementId", "awardedAt", "id", "points", "userId" FROM "AchievementAward";
DROP TABLE "AchievementAward";
ALTER TABLE "new_AchievementAward" RENAME TO "AchievementAward";
CREATE UNIQUE INDEX "AchievementAward_userId_achievementId_key" ON "AchievementAward"("userId", "achievementId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


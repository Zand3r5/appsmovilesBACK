ALTER TABLE "Genre" ADD COLUMN "tmdbId" INTEGER;

-- Existing genres came from TMDB, so their old primary key is their TMDB ID.
UPDATE "Genre" SET "tmdbId" = "id";

CREATE UNIQUE INDEX "Genre_tmdbId_key" ON "Genre"("tmdbId");
CREATE UNIQUE INDEX "Genre_name_key" ON "Genre"("name");

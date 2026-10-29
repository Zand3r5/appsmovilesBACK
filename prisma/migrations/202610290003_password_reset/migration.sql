CREATE TABLE "PasswordReset" (
  "emailKey" TEXT NOT NULL PRIMARY KEY,
  "id" TEXT NOT NULL,
  "userId" INTEGER,
  "codeHash" TEXT,
  "encryptedMail" TEXT,
  "requestedAt" DATETIME NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "sendAttempts" INTEGER NOT NULL DEFAULT 0,
  "nextSendAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" DATETIME,
  CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PasswordReset_id_key" ON "PasswordReset"("id");
CREATE INDEX "PasswordReset_expiresAt_idx" ON "PasswordReset"("expiresAt");

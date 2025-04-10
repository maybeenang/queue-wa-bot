/*
  Warnings:

  - You are about to drop the column `replyAt` on the `QueueItem` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_QueueItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "assignedAdminName" TEXT,
    "assignedAt" DATETIME,
    "timeoutStartedAt" DATETIME,
    "timeoutWarningSent" BOOLEAN DEFAULT false
);
INSERT INTO "new_QueueItem" ("assignedAdminName", "assignedAt", "chatId", "createdAt", "id", "updatedAt", "userId") SELECT "assignedAdminName", "assignedAt", "chatId", "createdAt", "id", "updatedAt", "userId" FROM "QueueItem";
DROP TABLE "QueueItem";
ALTER TABLE "new_QueueItem" RENAME TO "QueueItem";
CREATE UNIQUE INDEX "QueueItem_userId_key" ON "QueueItem"("userId");
CREATE INDEX "QueueItem_createdAt_idx" ON "QueueItem"("createdAt");
CREATE INDEX "QueueItem_assignedAdminName_idx" ON "QueueItem"("assignedAdminName");
CREATE INDEX "QueueItem_assignedAt_idx" ON "QueueItem"("assignedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

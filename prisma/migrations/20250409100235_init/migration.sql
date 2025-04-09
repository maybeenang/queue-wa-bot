-- CreateTable
CREATE TABLE "QueueItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AdminState" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "isServiceOnline" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "QueueItem_userId_key" ON "QueueItem"("userId");

-- CreateIndex
CREATE INDEX "QueueItem_createdAt_idx" ON "QueueItem"("createdAt");

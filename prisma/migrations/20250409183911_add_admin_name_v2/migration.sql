-- AlterTable
ALTER TABLE "QueueItem" ADD COLUMN "assignedAdminName" TEXT;
ALTER TABLE "QueueItem" ADD COLUMN "assignedAt" DATETIME;
ALTER TABLE "QueueItem" ADD COLUMN "replyAt" DATETIME;

-- CreateIndex
CREATE INDEX "QueueItem_assignedAdminName_idx" ON "QueueItem"("assignedAdminName");

-- CreateIndex
CREATE INDEX "QueueItem_assignedAt_idx" ON "QueueItem"("assignedAt");

-- CreateIndex
CREATE INDEX "QueueItem_replyAt_idx" ON "QueueItem"("replyAt");

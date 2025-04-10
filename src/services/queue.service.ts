import { QueueItem as PrismaQueueItem } from "../generated/prisma";
import logger from "../core/logger";
import { prisma } from "../core/db";

class QueueService {

    constructor() {
        logger.info("QueueService initialized.");
        this.logInitialQueueSize().catch((e) => {
            logger.error({ err: e }, "Error logging initial queue size.");
        });
    }

    private async logInitialQueueSize(): Promise<void> {
        try {
            const queueSize = await prisma.queueItem.count();
            logger.info(`Initial queue size: ${queueSize}`);
        } catch (error) {
            logger.error({ err: error }, "Failed to retrieve initial queue size.");
        }
    }

    async getQueueSize(): Promise<number> {
        try {
            return await prisma.queueItem.count();
        } catch (error) {
            logger.error({ err: error }, "Failed to retrieve queue size.");
            return 0;
        }
    }

    async getQueueList(): Promise<Readonly<PrismaQueueItem[]>> {
        try {
            return await prisma.queueItem.findMany({
                orderBy: {
                    createdAt: "asc",
                },
            });

        } catch (error) {
            logger.error({ err: error }, "Failed to retrieve queue list.");
            return [];
        }
    }

    async addToQueue(senderId: string, chatId: string): Promise<number | null> {
        try {
            const existingUser = await prisma.queueItem.findUnique({
                where: {
                    userId: senderId,
                }
            })

            if (existingUser) {
                logger.info({ userId: senderId }, "User already in queue.");
                return this.getUserPosition(senderId);
            }

            await prisma.queueItem.create({
                data: {
                    userId: senderId,
                    chatId: chatId,
                },
            });

            logger.info({ userId: senderId }, "User added to queue.");

            const position = await this.getUserPosition(senderId);
            if (position === null) {
                logger.error({ userId: senderId }, "Failed to retrieve user position after adding to queue.");
                return null;
            }

            logger.info({ userId: senderId, position }, "User position in queue retrieved.");
            return position;
        } catch (error: any) {

            if (error.code === "P2002") {
                logger.warn({ userId: senderId }, "User already in queue.");
                return this.getUserPosition(senderId);
            }

            logger.error({ err: error }, "Failed to add to queue.");
            return null;
        }
    }

    async getNextInQueue(): Promise<PrismaQueueItem | null> {
        try {

            const nextUser = await prisma.$transaction(async (tx) => {
                const oldestItem = await tx.queueItem.findFirst({
                    orderBy: {
                        createdAt: "asc",
                    },
                })

                if (!oldestItem) {
                    return null;
                }

                await tx.queueItem.delete({
                    where: {
                        id: oldestItem.id,
                    },
                });

                return oldestItem;
            })

            if (!nextUser) {
                logger.info("No users in queue.");
                return null;
            }

            logger.info({ userId: nextUser.userId }, "Next user in queue retrieved.");
            return nextUser;

        } catch (error) {
            logger.error({ err: error }, "Failed to retrieve next in queue.");
            return null;
        }
    }

    async assignNextUser(adminName: string): Promise<PrismaQueueItem | null> {
        const normalizedAdminName = adminName.toLowerCase().trim();
        if (!normalizedAdminName) {
            logger.error("AssignNextUser called with empty admin name.");
            return null;
        }

        try {
            const assignedItem = await prisma.$transaction(async (tx) => {
                const oldestUnassigned = await tx.queueItem.findFirst({
                    where: { assignedAdminName: null },
                    orderBy: { createdAt: 'asc' },
                });

                if (!oldestUnassigned) return null;

                const updatedItem = await tx.queueItem.update({
                    where: { id: oldestUnassigned.id },
                    data: {
                        assignedAdminName: normalizedAdminName,
                        updatedAt: new Date(),
                    },
                });
                return updatedItem;
            });

            if (assignedItem) {
                logger.info({ userId: assignedItem.userId, assignedTo: assignedItem.assignedAdminName }, 'Assigned next user and set assignment timestamp.');
            } else {
                logger.info('No unassigned users found in the queue.');
            }
            return assignedItem; // Kembalikan item yang diassign (atau null)
        } catch (error) {
            logger.error({ err: error, adminName: normalizedAdminName }, 'Failed assignNextUser transaction');
            return null; // Kembalikan null jika transaksi gagal
        }
    }

    async clearAssignmentTimestamp(userId: string): Promise<boolean> {
        if (!userId) return false;
        try {
            const result = await prisma.queueItem.updateMany({
                where: {
                    userId: userId,
                },
                data: {
                    timeoutStartedAt: null, // Set kembali ke null
                    timeoutWarningSent: false,
                    updatedAt: new Date(),
                },
            });
            // Jika ada baris yang terpengaruh (count > 0), berarti berhasil
            if (result.count > 0) {
                logger.info({ userId }, "Cleared assignment timestamp for user (responded in time).");
                return true;
            } else {
                logger.warn({ userId }, "Could not clear assignment timestamp (user/timestamp not found or already null).");
                return false;
            }
        } catch (error) {
            logger.error({ err: error, userId }, "Failed to clear assignment timestamp.");
            return false;
        }
    }


    async isQueueEmpty(): Promise<boolean> {
        try {
            return (await prisma.queueItem.count()) === 0;
        } catch (error) {
            logger.error({ err: error }, 'Failed to check if queue empty');
            return true; // Assume empty on error (safer for /on logic)
        }
    }

    async getUserPosition(senderId: string): Promise<number | null> {
        try {
            const sortedQueue = await prisma.queueItem.findMany(
                {
                    orderBy: {
                        createdAt: "asc",
                    },
                    select: {
                        userId: true,
                    }
                }
            )

            const index = sortedQueue.findIndex((item) => item.userId === senderId);

            return index === -1 ? null : index + 1; // 1-based index
        } catch (error) {
            logger.error({ err: error }, "Failed to get user position in queue.");
            return null;
        }
    }

    async removeFromQueue(senderId: string): Promise<boolean> {
        try {
            const result = await prisma.queueItem.deleteMany({
                where: {
                    userId: senderId,
                }
            })

            return result.count > 0;;

        } catch (error) {
            logger.error({ err: error }, "Failed to remove user from queue.");
            return false;
        }
    }

    async isUserInQueue(senderId: string): Promise<boolean> {
        try {
            const queueItem = await prisma.queueItem.findFirst({
                where: {
                    userId: senderId,
                },
            });

            return !!queueItem;
        } catch (error) {
            logger.error({ err: error }, "Failed to check if user is in queue.");
            return false;
        }
    }

    async isUserQueued(senderId: string): Promise<boolean> {
        try {
            const queueItem = await prisma.queueItem.findFirst({
                where: {
                    userId: senderId,
                    assignedAdminName: null, // Belum diassign
                },
            });

            return !!queueItem;
        } catch (error) {
            logger.error({ err: error }, "Failed to check if user is queued.");
            return false;
        }
    }

    async setOrResetTimeoutStart(userId: string): Promise<boolean> {
        if (!userId) return false;
        const now = new Date();
        try {
            // Update timestamp dan reset flag warning
            const result = await prisma.queueItem.updateMany({
                where: {
                    userId: userId,
                    assignedAdminName: { not: null }, // Pastikan user masih diassign
                },
                data: {
                    timeoutStartedAt: now, // Set/Reset timestamp mulai timeout
                    timeoutWarningSent: false, // Reset flag peringatan
                    updatedAt: now,
                },
            });
            if (result.count > 0) {
                logger.info({ userId, startedAt: now }, "Timeout timer started/reset for assigned user.");
                return true;
            } else {
                logger.warn({ userId }, "Could not start/reset timeout timer (user not found or not assigned).");
                return false;
            }
        } catch (error) {
            logger.error({ err: error, userId }, "Failed to set/reset timeout start.");
            return false;
        }
    }

    async clearTimeoutStart(userId: string): Promise<boolean> {
        if (!userId) return false;
        try {
            // Set timeoutStartedAt kembali ke null dan reset warning flag
            const result = await prisma.queueItem.updateMany({
                where: {
                    userId: userId,
                    timeoutStartedAt: { not: null }, // Hanya jika timer sedang berjalan
                },
                data: {
                    timeoutStartedAt: null,
                    timeoutWarningSent: false, // Reset juga flag warning
                    updatedAt: new Date(),
                },
            });
            if (result.count > 0) {
                logger.info({ userId }, "Timeout timer stopped (user responded).");
                return true;
            } else {
                logger.warn({ userId }, "Could not stop timeout timer (user not found or timer not running).");
                return false;
            }
        } catch (error) {
            logger.error({ err: error, userId }, "Failed to clear timeout start.");
            return false;
        }
    }

    async markTimeoutWarningSent(queueItemId: string): Promise<boolean> {
        if (!queueItemId) return false;
        try {
            await prisma.queueItem.update({
                where: { userId: queueItemId },
                data: { timeoutWarningSent: true, updatedAt: new Date() },
            });
            logger.info({ queueItemId }, "Marked timeout warning as sent.");
            return true;
        } catch (error) {
            logger.error({ err: error, queueItemId }, "Failed to mark timeout warning sent.");
            return false;
        }
    }


}

export const queueService = new QueueService();

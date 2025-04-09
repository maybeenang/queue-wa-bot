import { QueueItem as PrismaQueueItem } from "../generated/prisma";
import logger from "../core/logger";
import { prisma } from "../core/db";

class QueueService {

    constructor() {
        logger.info("QueueService initialized.");
        this.logInitialQueueSize();
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
        } catch (error) {
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


}

export const queueService = new QueueService();

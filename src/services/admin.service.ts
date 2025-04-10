import { prisma } from "../core/db";
import logger from "../core/logger";
import { Admin } from "../generated/prisma";

class AdminService {
    constructor() {
        logger.info("AdminService initialized.");
    }

    async addAdmin(name: string): Promise<Admin | null> {
        const normalizedName = name.trim().toLowerCase();
        if (!normalizedName) {
            logger.warn("Invalid admin name provided.");
            return null;
        }

        try {
            const existing = await this.findAdminByName(normalizedName);

            if (existing) {
                logger.info({ name: normalizedName }, "Admin already exists.");
                return existing;
            }

            const newAdmin = await prisma.admin.create({
                data: {
                    name: normalizedName,
                },
            })

            logger.info({ name: newAdmin.name }, "Admin added successfully.");
            return newAdmin;

        } catch (error) {
            logger.error({ err: error }, "Failed to add admin.");
            return null;
        }
    }

    async findAdminByName(name: string): Promise<Admin | null> {
        const normalizedName = name.trim().toLowerCase();
        if (!normalizedName) {
            return null;
        }

        try {
            const admin = await prisma.admin.findUnique({
                where: {
                    name: normalizedName,
                },
            });
            return admin;
        } catch (error) {
            logger.error({ err: error }, "Failed to find admin by name.");
            return null;
        }
    }

    async removeAdmin(name: string): Promise<boolean> {
        const normalizedName = name.trim().toLowerCase();
        if (!normalizedName) {
            logger.warn("Invalid admin name provided.");
            return false;
        }

        try {
            const existing = await this.findAdminByName(normalizedName);

            if (!existing) {
                logger.info({ name: normalizedName }, "Admin not found.");
                return false;
            }

            // check apakah admin sedang assign ke user
            const assignedItems = await prisma.queueItem.findMany({
                where: {
                    assignedAdminName: normalizedName,
                },
            });

            if (assignedItems.length > 0) {
                logger.warn({ name: normalizedName }, "Admin cannot be removed because they are currently assigned to users.");
                return false;
            }


            await prisma.admin.delete({
                where: {
                    id: existing.id,
                },
            });

            logger.info({ name: normalizedName }, "Admin removed successfully.");
            return true;

        } catch (error) {
            logger.error({ err: error }, "Failed to remove admin.");
            return false;
        }
    }

    async listAdminNames(): Promise<string[]> {
        try {
            const admins = await prisma.admin.findMany({
                select: {
                    name: true,
                },
                orderBy: {
                    createdAt: "asc",
                }
            });

            return admins.map(admin => admin.name);
        } catch (error) {
            logger.error({ err: error }, "Failed to list admin names.");
            return [];
        }
    }
}

export const adminService = new AdminService();

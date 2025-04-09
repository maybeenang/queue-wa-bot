import logger from "../core/logger";
import { prisma } from "../core/db";

const STATE_ID = 1;

class StateService {

    private isInitialized: boolean = false;

    constructor() { }

    async initialize() {
        if (this.isInitialized) {
            return;
        }

        try {
            logger.info("Initializing AdminState in database...");
            await prisma.adminState.upsert({
                where: { id: STATE_ID },
                update: {},
                create: {
                    id: STATE_ID,
                    isServiceOnline: false,
                }
            });
            this.isInitialized = true;
            logger.info(`AdminState initialized successfully. Service is : ${this.isInitialized ? "ON" : "OFF"}`);

        } catch (error) {
            logger.error({ err: error }, "Failed to initialize AdminState in database.");
            process.exit(1);
        }
    }

    private ensureInitialized(): void {
        if (!this.isInitialized) {
            logger.error("StateService accessed before initialization.");
            throw new Error("StateService not initialized.");
        }
    }

    async setServiceStatus(isOnline: boolean): Promise<void> {
        this.ensureInitialized();

        try {
            const currentState = await this.isServiceOnline();
            if (currentState === isOnline) {
                logger.info(`Service status is already ${isOnline ? "online" : "offline"}. No update needed.`);
                return;
            }

            logger.info(`Updating service status to ${isOnline ? "online" : "offline"}.`);
            await prisma.adminState.update({
                where: { id: STATE_ID },
                data: { isServiceOnline: isOnline },
            });

            logger.info(`Service status updated to ${isOnline ? "online" : "offline"}.`);
        } catch (error) {

            logger.error({ err: error }, "Failed to update service status.");

            throw error;
        }
    }

    async isServiceOnline(): Promise<boolean> {
        this.ensureInitialized();

        try {

            const state = await prisma.adminState.findUnique({
                where: { id: STATE_ID },
            })

            if (!state) {
                logger.error("AdminState not found in database. Re-initializing...");
                await this.initialize();
                const newState = await prisma.adminState.findUnique({
                    where: { id: STATE_ID },
                });
                return newState ? newState.isServiceOnline : false;
            }

            return state.isServiceOnline;

        } catch (error) {
            logger.error({ err: error }, "Failed to check service status.");
            return false;
        }
    }
}

export const stateService = new StateService();

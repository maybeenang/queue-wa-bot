import { connectDb, prisma } from "./core/db";
import logger from "./core/logger";
import { stateService } from "./services/state.service";
import { whatsappService } from "./services/whatsapp.service";

async function main() {
    logger.info("Starting the application...");
    logger.info("Initializing services...");

    await connectDb();
    await stateService.initialize();

    whatsappService.initialize();

    logger.info("Application started successfully.");
}

async function shutdown(
    signal: NodeJS.Signals | "uncaughtException" | "unhandledRejection",
    exitCode: number,
    error?: Error | any,
) {
    if (error) {
        if (signal === "uncaughtException") logger.fatal({ err: error }, "Uncaught Exception");
        else if (signal === "unhandledRejection") logger.fatal({ err: error }, "Unhandled Rejection");
        else logger.fatal({ err: error }, `Shutdown due to ${signal}`);
    } else {
        logger.warn(`Shutdown due to ${signal}`);
    }

    logger.info("Disconnecting from database...");
    try {
        await prisma.$disconnect();
        logger.info("Disconnected from database.");
    } catch (error) {
        logger.error({ err: error }, "Failed to disconnect from database.");
    }

    logger.info("Exiting application...");
    process.exit(exitCode);
}

process.on("uncaughtException", (error) => shutdown("uncaughtException", 1, error));
process.on("unhandledRejection", (error) => shutdown("unhandledRejection", 1, error));

(['SIGINT', 'SIGTERM', 'SIGQUIT'] as NodeJS.Signals[]).forEach((signal) => {
    process.on(signal, () => shutdown(signal, 0));
})

main()
    .catch((error) => {
        logger.error({ err: error }, "Error in main function.");
        shutdown("uncaughtException", 1, error);
    });




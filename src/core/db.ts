import logger from "./logger";
import config from "./config";
import { PrismaClient } from "../generated/prisma";

type PrismaLogLevel = "query" | "info" | "warn" | "error";

const pinoToPrismaLogLevelMap: { [key: string]: PrismaLogLevel[] } = {
    fatal: ["error"],
    error: ["error"],
    warn: ["warn", "error"],
    info: ["info", "warn", "error"],
    debug: ["query", "info", "warn", "error"],
    trace: ["query", "info", "warn", "error"],
}

const prismaLogLevel = pinoToPrismaLogLevelMap[config.LOG_LEVEL] || ["query", "info", "warn", "error"];

const prisma = new PrismaClient({
    log: prismaLogLevel.map(
        (level) => ({ level, emit: 'event' } as {
            level: PrismaLogLevel;
            emit: 'event';
        })),
    errorFormat: 'pretty',
})

prisma.$on('query', (e) => logger.trace({ prisma: 'query', duration: e.duration, query: e.query, params: e.params }, 'Prisma query'));
prisma.$on('info', (e) => logger.debug({ prisma: 'info', message: e.message, target: e.target }, 'Prisma info'));
prisma.$on('warn', (e) => logger.warn({ prisma: 'warn', message: e.message, target: e.target }, 'Prisma warning'));
prisma.$on('error', (e) => logger.error({ prisma: 'error', message: e.message, target: e.target }, 'Prisma error'));

async function connectDb(): Promise<void> {
    try {
        logger.info('Connecting to database...');
        await prisma.$connect();
        logger.info('Database connection successful.');
    } catch (error) {
        logger.error({ err: error }, 'Database connection failed!');
        process.exit(1);
    }
}

export { prisma, connectDb };

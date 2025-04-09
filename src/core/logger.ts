import pino from "pino";
import config from "./config";

const isDevelopment = config.NODE_ENV === "development";

const logger = pino({
    level: config.LOG_LEVEL || "info",
    transport: isDevelopment ? {
        target: "pino-pretty",
        options: {
            colorize: isDevelopment,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
            levelFirst: true,
        }
    } : undefined,
})

logger.info("Logger initialized");

export default logger;

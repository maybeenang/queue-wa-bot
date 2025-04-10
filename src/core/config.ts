import dotenv from 'dotenv';

dotenv.config();

const defaultTimeoutResponse = 300;
const timeoutEnv = process.env.USER_RESPONSE_TIMEOUT_SECONDS;
let userResponseTimeoutMs = defaultTimeoutResponse * 1000;

if (timeoutEnv) {
    const parsedTimeout = parseInt(timeoutEnv, 10);
    if (!isNaN(parsedTimeout) && parsedTimeout > 10) {
        userResponseTimeoutMs = parsedTimeout * 1000;
        console.info(`USER_RESPONSE_TIMEOUT_SECONDS set to ${parsedTimeout} seconds.`);
    } else {
        console.warn(
            `Invalid USER_RESPONSE_TIMEOUT_SECONDS value: ${timeoutEnv}. Using default of ${defaultTimeoutResponse} seconds.`
        )
    }
} else {
    console.warn(
        `USER_RESPONSE_TIMEOUT_SECONDS not set. Using default of ${defaultTimeoutResponse} seconds.`
    )
}



const config = {
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    NODE_ENV: process.env.NODE_ENV || 'development',
    DATABASE_URL: process.env.DATABASE_URL,
    USER_RESPONSE_TIMEOUT_MS: userResponseTimeoutMs,
}

if (!config.DATABASE_URL) {
    console.error('Missing required environment variables: DATABASE_URL');
    process.exit(1);
}

export default config;

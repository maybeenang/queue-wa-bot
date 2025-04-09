import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const config = {
    ADMIN_PHONE_NUMBER: process.env.ADMIN_PHONE_NUMBER,
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    NODE_ENV: process.env.NODE_ENV || 'development',
    DATABASE_URL: process.env.DATABASE_URL,
}

if (!config.ADMIN_PHONE_NUMBER || !config.DATABASE_URL) {
    console.error('Missing required environment variables: ADMIN_PHONE_NUMBER, DATABASE_URL');
    process.exit(1);
}

if (!config.ADMIN_PHONE_NUMBER.endsWith('@c.us')) {
    console.warn("WARN: ADMIN_PHONE_NUMBER might not be in the correct format (e.g., 62xxxxxxxxxx@c.us)");
}

export default config;

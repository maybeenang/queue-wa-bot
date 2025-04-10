import logger from './core/logger';
import config from './core/config'; // Konfigurasi aplikasi
import { whatsappService } from './services/whatsapp.service'; // Service WhatsApp
import { stateService } from './services/state.service'; // Service status global
import { prisma, connectDb } from './core/db'; // Koneksi database Prisma
import { backgroundService } from './services/background.service'; // Service background task
async function main() {
    logger.info('--- Starting WhatsApp Queue Bot ---');
    logger.info(`Node Env: ${config.NODE_ENV}`);
    logger.info(`Log Level: ${config.LOG_LEVEL}`);
    logger.info(`User Timeout: ${config.USER_RESPONSE_TIMEOUT_MS / 1000} seconds`);
    logger.info('------------------------------------');

    await connectDb();

    await stateService.initialize();

    backgroundService.setWhatsAppService(whatsappService);
    //    Mulai pengecekan periodik (misal: timeout user)
    backgroundService.startChecks();

    whatsappService.initialize();

    logger.info('Application bootstrap complete. Bot is running and ready for events...');
}

/**
 * Fungsi untuk menangani shutdown aplikasi secara graceful.
 * Akan mencoba menghentikan background task dan disconnect database.
 * @param signal Sinyal shutdown (e.g., 'SIGINT') atau deskripsi error.
 * @param exitCode Kode exit proses (0 untuk sukses, 1 untuk error).
 * @param error Objek error (jika ada).
 */
async function shutdown(signal: NodeJS.Signals | string, exitCode: number, error?: Error | any) {
    // Log penyebab shutdown
    if (error) {
        if (signal === 'uncaughtException') logger.fatal({ err: error }, 'UNCAUGHT EXCEPTION!');
        else if (signal === 'unhandledRejection') logger.error({ reason: error }, 'UNHANDLED REJECTION!');
        else logger.error({ err: error, signal }, 'Shutdown initiated due to error.');
    } else {
        logger.warn(`Received ${signal}. Shutting down gracefully...`);
    }

    // Lakukan cleanup tasks:
    // 1. Hentikan background checks
    logger.info('Stopping background checks...');
    try {
        backgroundService.stopChecks();
        logger.info('Background checks stopped.');
    } catch (e) { logger.error({ err: e }, 'Error stopping background checks.'); }


    // 2. Disconnect dari database
    logger.info('Disconnecting database...');
    try {
        await prisma.$disconnect(); // Tutup koneksi Prisma
        logger.info('Database disconnected.');
    } catch (e) { logger.error({ err: e }, 'Error disconnecting database.'); }

    // Tambahkan cleanup lain jika perlu

    logger.info('Shutdown complete. Exiting application.');
    process.exit(exitCode); // Keluar dari proses Node.js
}

// --- Setup Event Listener untuk Shutdown & Error ---

// Tangani Uncaught Exception (error yang tidak tertangkap di try-catch)
process.on('uncaughtException', (err) => shutdown('uncaughtException', 1, err));

// Tangani Unhandled Rejection (Promise rejection yang tidak tertangkap di .catch())
process.on('unhandledRejection', (reason) => shutdown('unhandledRejection', 1, reason));

// Tangani sinyal shutdown dari OS (Ctrl+C, kill, dll.)
(['SIGINT', 'SIGTERM', 'SIGQUIT'] as NodeJS.Signals[]).forEach(signal => {
    process.on(signal, () => shutdown(signal, 0)); // Shutdown graceful (exit code 0)
});

// --- Jalankan Aplikasi ---
main().catch(err => shutdown('mainError', 1, err)); // Tangkap error fatal saat startup

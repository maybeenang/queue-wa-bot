import logger from '../core/logger';
import { queueService } from './queue.service';
import { WhatsAppService } from './whatsapp.service'; // Import tipe WhatsAppService
import config from '../core/config'; // Untuk mengakses timeout duration
import { prisma } from '../core/db'; // Perlu akses Prisma untuk query

async function notifyBotSelfBg(waService: WhatsAppService, message: string): Promise<void> {
    const botWID = waService.getBotWID(); // Dapatkan WID bot
    if (!botWID) {
        logger.error("BG: Cannot notify bot self: Bot WID unavailable.");
        return; // Tidak bisa kirim jika WID tidak ada
    }
    logger.debug(`BG: Notifying bot self (${botWID.split('@')[0]}): "${message.substring(0, 30)}..."`);
    // Kirim pesan ke WID bot itu sendiri
    await waService.sendMessage(botWID, `🔔 BOT INFO (Auto):\n${message}`)
        .catch(err => logger.warn({ err }, "BG: Failed send notification to bot self"));
}

// Interval pengecekan background (misalnya, setiap 60 detik)
const CHECK_INTERVAL_MS = 30 * 1000;
const WARNING_BEFORE_TIMEOUT_MS = 60 * 1000;

class BackgroundService {
    private checkIntervalId: NodeJS.Timeout | null = null;
    private waServiceInstance: WhatsAppService | null = null;

    constructor() { }

    public setWhatsAppService(instance: WhatsAppService): void {
        this.waServiceInstance = instance;
    }

    public startChecks(): void {
        if (this.checkIntervalId) {
            logger.warn('Background checks already running.');
            return;
        }
        if (!this.waServiceInstance) {
            // Harus ada instance WA Service sebelum memulai
            logger.error("Cannot start Background Checks: WhatsAppService instance not set!");
            return;
        }

        const timeoutMs = config.USER_RESPONSE_TIMEOUT_MS;
        const warningThreshold = timeoutMs - WARNING_BEFORE_TIMEOUT_MS;
        const actualWarningThreshold = Math.max(warningThreshold, 0);

        logger.info(`Starting user response timeout check every ${CHECK_INTERVAL_MS / 1000}s (Timeout: ${timeoutMs / 1000}s).`);

        // Jalankan pengecekan setiap CHECK_INTERVAL_MS
        this.checkIntervalId = setInterval(async () => {

            if (!this.waServiceInstance) {
                logger.error("BG Check interval running without waServiceInstance! Stopping check.");
                this.stopChecks(); // Hentikan jika instance hilang
                return;
            }
            logger.trace('Running periodic user timeout check...');

            try {
                const potentiallyTimedOutItems = await prisma.queueItem.findMany({
                    where: {
                        assignedAdminName: { not: null },
                        timeoutStartedAt: { not: null },
                    },
                });

                if (potentiallyTimedOutItems.length === 0) {
                    logger.trace("No assigned users with active timeout timestamp found.");
                    return;
                }

                const now = Date.now(); // Waktu saat ini
                logger.trace(`Checking ${potentiallyTimedOutItems.length} assigned items for timeout...`);

                for (const item of potentiallyTimedOutItems) {
                    // Safety check (seharusnya tidak null berdasarkan query where)
                    if (!item.timeoutStartedAt) continue;

                    // 3. Hitung waktu yang telah berlalu sejak diassign
                    const timeElapsed = now - item.timeoutStartedAt.getTime();

                    // 4. Bandingkan dengan durasi timeout
                    if (timeElapsed >= timeoutMs) {
                        // --- TIMEOUT TERJADI ---
                        logger.warn({ userId: item.userId, assignedAdmin: item.assignedAdminName, assignedAt: item.assignedAt }, `User timeout detected (${timeElapsed}ms >= ${timeoutMs}ms). Removing from queue.`);

                        const removed = await queueService.removeFromQueue(item.userId);

                        if (removed) {

                            await this.waServiceInstance.sendMessage(item.chatId,
                                `Maaf, waktu Anda untuk merespons admin ${item.assignedAdminName ?? ''} (${Math.floor(timeoutMs / 1000) > 60 ? `${Math.floor(timeoutMs / 1000 / 60)} menit` : `${Math.floor(timeoutMs / 1000)} detik`}) telah habis. Anda telah dikeluarkan dari antrian.`)
                                .catch(err => logger.error({ err, userId: item.userId }, "Failed sending timeout notification to user"));

                            await notifyBotSelfBg(this.waServiceInstance, `⏱️ Timeout: User +${item.userId.split('@')[0]} dihapus karena tidak merespons admin ${item.assignedAdminName ?? '?'} dalam ${timeoutMs / 1000} detik.`);
                        } else {
                            logger.error({ userId: item.userId }, "Failed to remove timed-out user from queue (removeFromQueue returned false).");
                        }
                        continue;
                    }
                    // --- WARNING SEBELUM TIMEOUT ---
                    if (timeElapsed >= actualWarningThreshold && !item.timeoutWarningSent) {
                        // Kirim notifikasi ke admin
                        logger.warn({ userId: item.userId, assignedAdmin: item.assignedAdminName, assignedAt: item.assignedAt }, `User timeout warning (${timeElapsed}ms >= ${actualWarningThreshold}ms).`);

                        const remainingSeconds = Math.max(0, Math.round((timeoutMs - timeElapsed) / 1000)); // Hitung sisa detik

                        await this.waServiceInstance.sendMessage(item.chatId,
                            `⚠️ Perhatian! Sisa waktu Anda untuk merespons admin ${item.assignedAdminName ?? ''} sekitar ${remainingSeconds > 60 ? '1 menit' : remainingSeconds + ' detik'} sebelum dikeluarkan dari antrian.`
                        )
                            .catch(err => logger.error({ err, userId: item.userId }, "Failed sending timeout warning notification to user"));

                        //await notifyBotSelfBg(this.waServiceInstance, `⏱️ Warning: User +${item.userId.split('@')[0]} akan dihapus dalam ${(timeoutMs - timeElapsed) / 1000} detik jika tidak merespons admin ${item.assignedAdminName ?? '?'}!`);

                        // Update status warning di DB
                        await queueService.markTimeoutWarningSent(item.userId)
                    }

                } // Akhir loop for

            } catch (error) {
                // Tangani error yang mungkin terjadi selama proses pengecekan
                logger.error({ err: error }, 'Error during user timeout check interval.');
            }
        }, CHECK_INTERVAL_MS); // Interval pengecekan
    }

    /**
     * Menghentikan pengecekan background periodik.
     */
    public stopChecks(): void {
        if (this.checkIntervalId) {
            logger.info('Stopping background checks.');
            clearInterval(this.checkIntervalId); // Hentikan timer
            this.checkIntervalId = null; // Reset ID interval
        }
    }
}

// Export instance singleton dari BackgroundService
export const backgroundService = new BackgroundService();

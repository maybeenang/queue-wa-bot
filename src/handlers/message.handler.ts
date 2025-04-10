import { Message } from 'whatsapp-web.js';
import logger from '../core/logger';
import { queueService } from '../services/queue.service';
import { stateService } from '../services/state.service';
import { adminService } from '../services/admin.service';
import { WhatsAppService } from '../services/whatsapp.service';
import config from '../core/config';
import { prisma } from '../core/db';

async function notifyBotSelf(waService: WhatsAppService, message: string): Promise<void> {
    const botWID = waService.getBotWID(); // Dapatkan nomor bot
    if (!botWID) {
        // Jangan kirim jika nomor bot tidak tersedia
        logger.error("Cannot notify bot self: Bot WID not available.");
        return;
    }
    logger.debug(`Notifying bot self (${botWID.split('@')[0]}): "${message.substring(0, 30)}..."`);
    // Kirim pesan ke nomor bot itu sendiri
    await waService.sendMessage(botWID, `🔔 BOT INFO:\n${message}`)
        .catch(err => logger.warn({ err }, "Failed to send notification to bot self"));
}

export const messageHandler = async (
    waService: WhatsAppService,
    message: Message,
    isFromMe: boolean // Flag dari WhatsAppService
): Promise<void> => {
    const senderId = message.from; // Pengirim pesan (bisa bot atau user)
    const chatId = message.id.remote; // Chat ID tempat pesan diterima
    const body = message.body?.trim() ?? ''; // Isi pesan teks
    // Abaikan jika tidak ada isi teks
    if (!body) return;

    // --- Logika Deteksi Respons User yang Sedang Ditugaskan ---
    if (!isFromMe) {
        try {
            // Cek di DB apakah user ini memiliki timestamp `assignedAt` yang aktif
            const queueItem = await prisma.queueItem.findUnique({
                where: { userId: senderId },
                select: {
                    timeoutStartedAt: true,
                    assignedAdminName: true,
                }, // Cukup cek field ini
            });

            // Jika `assignedAt` ada nilainya (tidak null), berarti user merespons dalam masa timeout
            if (queueItem?.timeoutStartedAt) {
                logger.info({ userId: senderId }, "Assigned user responded within timeout. Clearing assignment timestamp.");
                // Hapus timestamp `assignedAt` untuk menghentikan timer timeout
                await queueService.clearAssignmentTimestamp(senderId);
            }
        } catch (error) {
            // Log error jika gagal memeriksa/membersihkan timestamp
            logger.error({ err: error, userId: senderId }, "Error checking/clearing assignment timestamp on user message");
        }
    }

    // --- Logika Perintah (Hanya jika pesan dari Bot Sendiri) ---
    if (isFromMe) {

        try {
            const recipientId = message.to;
            const queueItem = await prisma.queueItem.findFirst({
                where: {
                    userId: recipientId, // Apakah pesan ini ke user di antrian?
                    assignedAdminName: { not: null }, // Apakah user itu sedang diassign?
                    timeoutStartedAt: null, // Apakah timer BELUM dimulai?
                },
                select: { id: true, assignedAdminName: true } // Ambil info yg perlu
            });

            if (queueItem) {
                logger.info({ admin: queueItem.assignedAdminName, user: recipientId }, "Admin message to assigned user detected. Starting/Resetting timeout timer.");
                await queueService.setOrResetTimeoutStart(recipientId);
            }
        } catch (error) {
            logger.error({ err: error, messageId: message.id.id }, "Error checking/starting timeout on bot message creation");
        }



        // Hanya proses jika pesan diawali dengan '/'
        if (body.startsWith('/')) {
            const commandParts = body.toLowerCase().split(' ');
            const command = commandParts[0]; // Ambil perintah (e.g., /status)
            const commandArgs = commandParts.slice(1); // Ambil argumen setelah perintah

            const botWID = waService.getBotWID() ?? 'bot'; // Dapatkan WID bot untuk logging
            logger.info({ command, args: commandArgs, executor: 'bot_self', chatId }, "Processing self-command");

            // Dapatkan status layanan ON/OFF saat ini
            let serviceIsOnline: boolean;
            try {
                serviceIsOnline = await stateService.isServiceOnline();
            } catch (error) {
                // Jika gagal mendapatkan status, balas error dan hentikan
                await waService.sendMessage(chatId, "⚠️ Gagal memeriksa status layanan.");
                return;
            }

            // --- Switch Case untuk Menangani Setiap Perintah ---
            switch (command) {
                // --- Perintah Manajemen Status Layanan ---
                case '/on':
                    if (serviceIsOnline) { await waService.sendMessage(chatId, '⚠️ Layanan sudah ON.'); break; }
                    try {
                        const queueIsEmpty = await queueService.isQueueEmpty();
                        if (!queueIsEmpty) {
                            const size = await queueService.getQueueSize();
                            await waService.sendMessage(chatId, `❌ Gagal ON. Masih ada ${size} antrian.`);
                        } else {
                            await stateService.setServiceStatus(true);
                            await waService.sendMessage(chatId, '✅ Layanan diaktifkan (ON).');
                            logger.info({ executor: 'bot_self', chatId }, 'Service turned ON');
                        }
                    } catch (error) { await waService.sendMessage(chatId, "⚠️ Gagal mengaktifkan layanan."); }
                    break;
                case '/off':
                    if (!serviceIsOnline) { await waService.sendMessage(chatId, '⚠️ Layanan sudah OFF.'); break; }
                    try {
                        await stateService.setServiceStatus(false);
                        await waService.sendMessage(chatId, '☑️ Layanan dinonaktifkan (OFF).');
                        logger.info({ executor: 'bot_self', chatId }, 'Service turned OFF');
                    } catch (error) { await waService.sendMessage(chatId, "⚠️ Gagal menonaktifkan layanan."); }
                    break;

                // --- Perintah Melihat Status Antrian ---
                case '/status':
                    try {
                        const currentQueue = await queueService.getQueueList();
                        const queueSize = currentQueue.length;
                        let statusMsg = `📊 Status: ${serviceIsOnline ? 'ON' : 'OFF'}\n` +
                            `👥 Total Antrian: ${queueSize}\n\n`;
                        if (queueSize > 0) {
                            statusMsg += 'Daftar Antrian:\n' +
                                currentQueue.map((item, i) => {
                                    let assignmentStatus = '(Menunggu)';
                                    if (item.assignedAdminName) {
                                        assignmentStatus = `-> ${item.assignedAdminName}`;
                                        if (item.timeoutStartedAt) {
                                            // Timer sedang berjalan
                                            const deadline = new Date(item.timeoutStartedAt.getTime() + config.USER_RESPONSE_TIMEOUT_MS);
                                            assignmentStatus += ` (Timer aktif s/d ${deadline.toLocaleTimeString('id-ID')}) ${item.timeoutWarningSent ? '[Warning Sent]' : ''}`;
                                        } else {
                                            // Timer tidak berjalan (sudah direspons atau belum dimulai)
                                            assignmentStatus += ' (Timer nonaktif)';
                                        }
                                    }
                                    return `${i + 1}. +${item.userId.split('@')[0]} ${assignmentStatus}`;
                                }).join('\n');
                        } else {
                            statusMsg += 'Antrian kosong.';
                        }
                        await waService.sendMessage(chatId, statusMsg);
                    } catch (error) {
                        logger.error({ err: error }, "Failed to get queue status");
                        await waService.sendMessage(chatId, "⚠️ Gagal mengambil status antrian.");
                    }
                    break;

                case '/next':
                    if (serviceIsOnline) { await waService.sendMessage(chatId, '⚠️ Layanan ON.'); break; }

                    const targetAdminName = commandArgs.join(' ').trim();
                    if (!targetAdminName) { await waService.sendMessage(chatId, '❌ Format: /next <nama admin>'); break; }
                    const normalizedTargetAdmin = targetAdminName.toLowerCase();

                    const targetAdmin = await adminService.findAdminByName(normalizedTargetAdmin);
                    if (!targetAdmin) { await waService.sendMessage(chatId, `⚠️ Admin "${targetAdminName}" tidak ditemukan.`); break; }

                    // --- Langkah BARU: Cek dan Lepas Tugas Admin Sebelumnya ---
                    try {
                        const previousAssignment = await prisma.queueItem.findFirst({
                            where: { assignedAdminName: normalizedTargetAdmin },
                        });

                        if (previousAssignment) {
                            logger.warn({ admin: normalizedTargetAdmin, previousUser: previousAssignment.userId }, `/next triggered for admin with existing assignment. Unassigning previous user.`);
                            await queueService.removeFromQueue(
                                previousAssignment.userId,
                            )
                            // Notifikasi ke chat bot (asal command /next)
                            await waService.sendMessage(chatId, `ℹ️ Info: User +${previousAssignment.userId.split('@')[0]} sebelumnya dilepas dari admin ${normalizedTargetAdmin}.`);
                            // Notifikasi ke user yang dilepas
                            await waService.sendMessage(previousAssignment.chatId, `ℹ️ Admin ${normalizedTargetAdmin} terputus dari chat.`)
                                .catch(err => logger.warn({ err, userId: previousAssignment.userId }, "Failed to notify previously assigned user about unassignment."));
                        }
                    } catch (error) {
                        logger.error({ err: error, admin: normalizedTargetAdmin }, "Error checking/unassigning previous user before /next.");
                        await waService.sendMessage(chatId, `⚠️ Terjadi error saat memeriksa tugas admin sebelumnya, mencoba melanjutkan...`);
                    }
                    // --- Akhir Langkah BARU ---

                    // --- Lanjutkan Proses Assignment User Baru (Logika Sebelumnya) ---
                    const assignedUser = await queueService.assignNextUser(normalizedTargetAdmin);

                    if (assignedUser) {
                        // Konfirmasi assignment baru ke chat bot
                        await waService.sendMessage(chatId, `✅ User +${assignedUser.userId.split('@')[0]} dialihkan ke ${normalizedTargetAdmin}.`);
                        // Notif ke user baru
                        await waService.sendMessage(assignedUser.chatId, `🔔 Giliran Anda tiba! Akan dilayani oleh admin ${normalizedTargetAdmin}.`);
                        logger.info({ assignedUserId: assignedUser.userId, assignedTo: normalizedTargetAdmin, executor: 'bot_self' }, '/next assignment successful');
                    } else {
                        // Tidak ada user baru yang bisa diassign
                        await waService.sendMessage(chatId, 'ℹ️ Tidak ada antrian yang menunggu untuk dialihkan saat ini.');
                    }
                    break;
                // --- Perintah Menghapus User dari Antrian ---
                case '/remove':
                    const userIdToRemove = commandArgs[0]?.trim(); // Ambil userId dari argumen
                    if (!userIdToRemove || !userIdToRemove.includes('@c.us')) {
                        await waService.sendMessage(chatId, '❌ Format perintah salah. Gunakan: /remove 62xxxxxxxxxx@c.us');
                        break;
                    }
                    try {
                        const removed = await queueService.removeFromQueue(userIdToRemove);
                        if (removed) {
                            await waService.sendMessage(chatId, `✅ Pengguna ${userIdToRemove.split('@')[0]} berhasil dihapus dari antrian.`);
                            logger.info({ removedUserId: userIdToRemove, executor: 'bot_self' }, 'User removed via /remove');
                        } else {
                            await waService.sendMessage(chatId, `⚠️ Pengguna ${userIdToRemove.split('@')[0]} tidak ditemukan dalam antrian.`);
                        }
                    } catch (error) {
                        logger.error({ err: error, userIdToRemove }, "Failed processing /remove command.");
                        await waService.sendMessage(chatId, `⚠️ Gagal menghapus pengguna ${userIdToRemove.split('@')[0]}.`);
                    }
                    break;

                // --- Perintah Manajemen Admin ---
                case '/list-admin':
                    try {
                        const admins = await adminService.listAdminNames(); // Dapatkan daftar nama admin
                        let response = `👤 Daftar Admin (${admins.length}):\n`;
                        response += admins.length > 0
                            ? admins.map((name, i) => `${i + 1}. ${name}`).join('\n') // Format daftar
                            : "Belum ada admin terdaftar."; // Pesan jika kosong
                        await waService.sendMessage(chatId, response); // Kirim daftar ke chat asal
                    } catch (error) { await waService.sendMessage(chatId, "⚠️ Gagal mengambil daftar admin."); }
                    break;

                case '/add-admin':
                    const nameToAdd = commandArgs.join(' ').trim(); // Ambil nama dari argumen
                    if (!nameToAdd) { await waService.sendMessage(chatId, '❌ Format: /add-admin <nama admin>'); break; }
                    try {
                        const added = await adminService.addAdmin(nameToAdd); // Coba tambahkan admin
                        if (added) {
                            await waService.sendMessage(chatId, `✅ Admin "${added.name}" berhasil ditambahkan.`);
                        } else {
                            // Gagal tambah (kemungkinan sudah ada)
                            await waService.sendMessage(chatId, `⚠️ Gagal menambahkan admin "${nameToAdd}". Mungkin nama sudah ada?`);
                        }
                    } catch (error) { await waService.sendMessage(chatId, `⚠️ Error saat menambah admin.`); }
                    break;

                case '/delete-admin':
                    const nameToRemove = commandArgs.join(' ').trim(); // Ambil nama dari argumen
                    if (!nameToRemove) { await waService.sendMessage(chatId, '❌ Format: /delete-admin <nama admin>'); break; }
                    try {
                        const removed = await adminService.removeAdmin(nameToRemove); // Coba hapus admin
                        if (removed) {
                            await waService.sendMessage(chatId, `✅ Admin "${nameToRemove.toLowerCase()}" berhasil dihapus.`);
                        } else {
                            // Gagal hapus (kemungkinan tidak ditemukan)
                            await waService.sendMessage(chatId, `⚠️ Admin "${nameToRemove}" tidak ditemukan.`);
                        }
                    } catch (error) { await waService.sendMessage(chatId, `⚠️ Error saat menghapus admin.`); }
                    break;

                // --- Perintah Tidak Dikenal ---
                default:

                    if (body.startsWith('/')) {
                        // berikan semua command yang ada
                        const msg = `
Berikut adalah daftar perintah yang tersedia:\n
- /on: Mengaktifkan layanan (jika antrian kosong).
- /off: Menonaktifkan layanan.
- /status: Melihat status layanan dan antrian saat ini.
- /next <nama admin>: Mengalihkan user berikutnya ke admin tertentu.
- /list-admin: Melihat daftar admin yang terdaftar.
- /add-admin <nama admin>: Menambahkan admin baru.
- /delete-admin <nama admin>: Menghapus admin dari daftar.
`
                        await waService.sendMessage(chatId, msg);
                    }
                    break;
            }
            // Setelah memproses command dari bot, hentikan eksekusi handler ini
            return;
        }
        // Jika pesan dari bot tapi BUKAN command (tidak diawali '/'), abaikan saja
        return;
    }

    // --- Logika User Biasa (Hanya jika BUKAN fromMe) ---
    if (!isFromMe) {
        // Dapatkan status layanan ON/OFF
        let serviceIsOnline: boolean;
        try { serviceIsOnline = await stateService.isServiceOnline(); }
        catch (error) { await waService.sendMessage(chatId, "Maaf, ada kendala teknis."); return; }

        // Jika layanan ON, jangan layani user biasa
        if (serviceIsOnline) {
            logger.debug({ userId: senderId }, 'Ignored user message (Service is ON)');
            return;
        }

        // --- Proses User Masuk Antrian ---
        try {

            // Cek apakah user sudah ada di antrian
            const existingPosition = await queueService.getUserPosition(senderId);
            if (existingPosition) {

                // jika sudah ada admin yang ditugaskan, maka biarkan mereka berkomunikasi
                const item = await queueService.isUserQueued(senderId);
                if (item) {
                    await waService.sendMessage(chatId, `Anda sudah dalam antrian dengan posisi ${existingPosition}.`);
                } else {
                    return; // Jika sudah ada admin yang ditugaskan, abaikan pesan ini
                }

            } else {
                // Jika belum ada, tambahkan ke antrian
                const newPosition = await queueService.addToQueue(senderId, chatId);
                if (newPosition) {
                    // Berhasil ditambahkan, beri tahu posisi baru
                    await waService.sendMessage(chatId, `Terima kasih telah menghubungi. Antrian Anda nomor ${newPosition}.\n\nMohon tunggu giliran Anda.`);
                    logger.info({ userId: senderId, pos: newPosition }, 'User added to queue.');
                    // Kirim notifikasi ke bot sendiri
                    const size = await queueService.getQueueSize();
                    await notifyBotSelf(waService, `📥 Antrian Baru: +${senderId.split('@')[0]} (pos ${newPosition}). Total: ${size}.`);
                } else {
                    // Gagal menambahkan (bukan karena sudah ada, tapi error lain)
                    await waService.sendMessage(chatId, 'Maaf, terjadi masalah saat menambahkan Anda ke antrian. Silakan coba beberapa saat lagi.');
                }
            }
        } catch (error) {
            logger.error({ err: error, userId: senderId }, "Error processing user queue entry/check");
            await waService.sendMessage(chatId, "Maaf, terjadi kesalahan saat memproses pesan Anda.");
        }
    }
};

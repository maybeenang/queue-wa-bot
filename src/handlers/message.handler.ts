import { Message } from "whatsapp-web.js"
import { WhatsAppService } from "../services/whatsapp.service"
import config from "../core/config";
import { stateService } from "../services/state.service";
import logger from "../core/logger";
import { queueService } from "../services/queue.service";

const sendMsg = async (waService: WhatsAppService, to: string, msg: string, fromMe: boolean = false, chatId?: string): Promise<void> => {

    fromMe ?
        await waService.sendMessage(chatId || to, msg) :
        await waService.sendMessage(to, msg);
}

export const messageHandler = async (waService: WhatsAppService, message: Message): Promise<void> => {

    const senderId = message.from;
    const chatId = message.id.remote;

    const body = message.body?.trim() || "";
    const fromMe = message.fromMe;

    if (!body) {
        return;
    }

    const isAdmin = senderId === config.ADMIN_PHONE_NUMBER || fromMe;

    if (isAdmin) {

        const commandParts = body.toLowerCase().split(" ");
        const command = commandParts[0];

        let serviceIsOnline: boolean;
        try {
            serviceIsOnline = await stateService.isServiceOnline();
        } catch (error) {
            logger.error({ err: error }, "Admin CMD: Failed to get state");
            await waService.sendMessage(senderId, "⚠️ Error cek status layanan."); return;
        }

        switch (command) {
            case "/on":
                if (serviceIsOnline) {

                    await sendMsg(waService, senderId, '⚠️ Layanan sudah ON.', fromMe, chatId);
                    return;
                }

                try {
                    const queueIsEmpty = await queueService.isQueueEmpty();
                    if (!queueIsEmpty) {
                        const size = await queueService.getQueueSize();
                        await waService.sendMessage(senderId, `❌ Gagal ON. Ada ${size} antrian.`); return;
                    }
                    await stateService.setServiceStatus(true);

                    logger.info({ adminId: senderId }, 'Admin set service ON');

                    await sendMsg(waService, senderId, '☑️ Layanan Admin: ON.', fromMe, chatId);

                } catch (error) { logger.error({ err: error }, "Failed /on"); await waService.sendMessage(senderId, "⚠️ Gagal set ON."); }
                break;
            case "/off":

                if (!serviceIsOnline) {

                    await sendMsg(waService, senderId, '⚠️ Layanan sudah OFF.', fromMe, chatId);
                    return;
                }

                try {
                    await stateService.setServiceStatus(false);
                    logger.info({ adminId: senderId }, 'Admin CMD: /off Admin set service OFF');

                    await sendMsg(waService, senderId, '☑️ Layanan Admin: OFF.', fromMe, chatId);

                } catch (error) { logger.error({ err: error }, "Failed /off"); await waService.sendMessage(senderId, "⚠️ Gagal set OFF."); }

                break;
            case "/status":
                try {
                    const currentQueue = await queueService.getQueueList();
                    const queueSize = currentQueue.length;
                    const statusMsg = `📊 Status: ${serviceIsOnline ? 'ON' : 'OFF'}\n` +
                        `👥 Antrian: ${queueSize}\n\n` +
                        (queueSize > 0
                            ? 'Daftar:\n' + currentQueue.map((item, i) => `${i + 1}. ${item.userId} (${new Date(item.createdAt).toLocaleTimeString('id-ID')})`).join('\n')
                            : 'Antrian kosong.');
                    logger.info({ queueSize }, "Admin CMD: /status");

                    await sendMsg(waService, senderId, statusMsg, fromMe, chatId);

                } catch (error) {
                    logger.error({ err: error }, "Admin CMD: Failed to get queue list");
                    await waService.sendMessage(senderId, "⚠️ Error cek status antrian.");
                }
                break;
            case "/next":
                if (serviceIsOnline) {
                    await sendMsg(waService, senderId, '⚠️ Layanan ON. Gunakan /off dulu.', fromMe, chatId);
                    return;
                }

                let nextUser;
                try {
                    nextUser = await queueService.getNextInQueue();
                } catch (error) {
                    logger.error({ err: error }, "Failed to get next in queue");
                    await sendMsg(waService, senderId, "⚠️ Error ambil antrian selanjutnya.", fromMe, chatId);
                }

                if (!nextUser) {
                    await sendMsg(waService, senderId, "❌ Antrian kosong. Tips: /on untuk aktifkan.", fromMe, chatId);
                    return;
                }

                logger.info({ nextUserId: nextUser.userId }, "Admin CMD: /next");

                await sendMsg(waService, senderId, `☑️ Antrian selanjutnya: ${nextUser.userId}`, fromMe, chatId);
                await waService.sendMessage(nextUser.chatId, `👋 Halo! Giliran anda sudah tiba!. Silakan tunggu admin untuk menghubungi anda.`);

                const remainingQueue = await queueService.getQueueList();
                if (remainingQueue.length > 0) {
                    await sendMsg(waService, senderId, `📊 Antrian tersisa: ${remainingQueue.length}`, fromMe, chatId);
                    await sendMsg(waService, senderId, `⏳ Mengirim notif ke ${remainingQueue.length} antrian tersisa...`, fromMe, chatId);

                    const promises = remainingQueue.map((user, i) => {
                        waService.sendMessage(user.chatId, `👋 Halo! Anda adalah antrian ke-${i + 1}. Silakan tunggu admin untuk menghubungi anda.`)
                            .catch((err) => {
                                logger.error({ err, userId: user.userId }, "Failed sending queue notification");
                            });
                    })

                    await Promise.allSettled(promises);
                    await sendMsg(waService, senderId, `📊 Notifikasi ke ${remainingQueue.length} antrian tersisa terkirim.`, fromMe, chatId);
                } else {
                    await sendMsg(waService, senderId, `📊 Antrian kosong.`, fromMe, chatId);
                }
                break;
            case "/remove":
                break;
            default:
                if (command.startsWith("/")) {
                    await waService.sendMessage(senderId, "❌ Perintah tidak dikenali.");
                    return;
                }
        }

        return;
    }

    if (!isAdmin) {

        let serviceIsOnline: boolean;

        try {
            serviceIsOnline = await stateService.isServiceOnline();
        } catch (error) {
            logger.error({ err: error }, "Failed to get state");
            await waService.sendMessage(senderId, "Maaf, terjadi kesalahan teknis.");
            return;
        }

        if (serviceIsOnline) {
            logger.debug({ senderId }, " Incoming message from user");
            return;
        }

        try {
            const existingPosition = await queueService.getUserPosition(senderId);

            if (existingPosition !== null) {
                await waService.sendMessage(chatId, `Anda dalam antrian ke-${existingPosition}, Mohon tunggu admin untuk menghubungi anda.`);
                return;
            }

            const isInQueue = await queueService.isUserInQueue(senderId);
            if (isInQueue) {
                await waService.sendMessage(chatId, `Anda dalam antrian ke-${existingPosition}, Mohon tunggu admin untuk menghubungi anda.`);
                return;
            }

            const newPosition = await queueService.addToQueue(senderId, chatId);

            if (newPosition) {
                await waService.sendMessage(chatId, `Anda dalam antrian ke-${newPosition}, Mohon tunggu admin untuk menghubungi anda.`);
                logger.info({ senderId, position: newPosition }, "User added to queue");

                // TODO: notifikasi ke admin
            } else {
                await waService.sendMessage(chatId, "Maaf, terjadi kesalahan teknis.");
                logger.error({ senderId }, "Failed to add user to queue");
            }

        } catch (error) {

            logger.error({ err: error }, "Failed to add user to queue");
            await waService.sendMessage(chatId, "Maaf, terjadi kesalahan teknis.");
        }

        return;
    }
}

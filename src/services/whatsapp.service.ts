import { Chat, Client, ClientOptions, LocalAuth, Message } from "whatsapp-web.js";
import logger from "../core/logger";
import qrcode from "qrcode-terminal";
import { messageHandler } from "../handlers/message.handler";
import { QueueItem } from "../generated/prisma";

export class WhatsAppService {

    private client: Client;
    private isInitialized: boolean = false;

    constructor() {
        logger.info("Initializing WhatsAppService...");
        const clientOptions: ClientOptions = {
            authStrategy: new LocalAuth(),
            puppeteer: {
                headless: true,
                args: [
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-accelerated-2d-canvas",
                    "--disable-gpu",
                    "--disable-software-rasterizer",
                ],
            }
        }

        this.client = new Client(clientOptions);
        this.setupEventHandlers();
    }

    private setupEventHandlers(): void {
        this.client.on("qr", (qr) => {
            logger.info("QR Code received, scan it to log in");
            qrcode.generate(qr, { small: true });
        });

        this.client.on("ready", () => {
            this.isInitialized = true;
            logger.info("WhatsApp client is ready.");
            logger.info("Logged in as:", this.client.info.wid.user);
        });

        this.client.on("authenticated", () => {
            logger.info("WhatsApp client authenticated.");
        });

        this.client.on("disconnected", (reason) => {
            logger.warn("WhatsApp client disconnected:", reason);
            this.isInitialized = false;
        });

        this.client.on("auth_failure", (msg) => {
            logger.error("WhatsApp client authentication failed:", msg);
        });

        this.client.on("message_create", async (message: Message) => {

            if (message.isStatus || message.from.includes("@g.us")) {
                return;
            }

            logger.debug({ from: message.from, body: message.body }, "Received message");

            try {

                await messageHandler(this, message);

            } catch (error) {
                logger.error({ err: error, messageId: message.id.id }, "Unhandled error in message handler");
            }

        })
    }

    public initialize(): void {

        if (this.isInitialized) {
            logger.warn("WhatsApp client is already initialized.");
            return;
        }

        this.client.initialize().catch((error) => {
            logger.fatal({ err: error }, "Failed to initialize WhatsApp client.");
            process.exit(1);
        })

    }

    async sendMessage(to: string, message: string): Promise<Message | null> {
        if (!this.isInitialized) {
            logger.warn("cannot send message, client is not initialized");
            return null;
        }

        try {
            logger.debug({ to, message: message.substring(0, 50) + '...' }, "Sending message");

            const sentMessage = await this.client.sendMessage(to, message.trim());

            return sentMessage;
        } catch (error) {
            logger.error({ err: error }, "Failed to send message");
            return null;
        }

    }

    async getChatById(chatId: string): Promise<Chat | null> {

        if (!this.isInitialized) return null;

        try {
            return await this.client.getChatById(chatId);
        } catch (error) {
            logger.error({ err: error, chatId }, 'Failed to get chat by ID');
            return null;
        }
    }

    // Helper untuk notifikasi antrian (menggunakan tipe Prisma)
    async getChatsFromQueueItems(queueItems: Readonly<QueueItem[]>): Promise<Chat[]> {
        const chats: Chat[] = [];

        if (!this.isInitialized || !queueItems.length) return chats;

        logger.debug(`Fetching chats for ${queueItems.length} queue items...`);

        // Bisa dioptimasi jika perlu, misal ambil semua chat sekali lalu filter
        for (const item of queueItems) {
            try {
                const chat = await this.getChatById(item.chatId);
                if (chat) chats.push(chat);
                else logger.warn({ chatId: item.chatId }, "Chat not found for queue item");
            } catch (error) {
                logger.error({ err: error, chatId: item.chatId }, "Error fetching chat for notification");
            }
        }
        logger.debug(`Fetched ${chats.length} chats for notifications.`);
        return chats;
    }

}

export const whatsappService = new WhatsAppService();


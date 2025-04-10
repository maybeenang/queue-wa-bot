import { Client, LocalAuth, Message, ClientOptions, Chat, Contact } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import logger from '../core/logger';
import { messageHandler } from '../handlers/message.handler';
import { QueueItem } from '../generated/prisma'; // Digunakan di helper jika perlu

/**
 * Service utama untuk mengelola koneksi dan interaksi dengan WhatsApp Web.
 */
export class WhatsAppService {
    private client: Client; // Instance client whatsapp-web.js
    private isInitialized = false; // Status apakah client sudah siap
    private botWID: string | null = null; // WhatsApp ID (nomor) bot setelah login

    constructor() {
        logger.info('Initializing WhatsApp Client...');
        // Konfigurasi client whatsapp-web.js
        const clientOptions: ClientOptions = {
            // Gunakan LocalAuth untuk menyimpan sesi login di folder lokal
            // `dataPath` menentukan nama folder sesi
            authStrategy: new LocalAuth(),
            // Konfigurasi Puppeteer (browser headless yang menjalankan WhatsApp Web)
            puppeteer: {
                headless: true, // Jalankan tanpa UI browser
                // Argumen penting untuk stabilitas di server (terutama Linux)
                args: [
                    '--no-sandbox', // Menonaktifkan sandbox (diperlukan di banyak environment server)
                    '--disable-setuid-sandbox', // Menonaktifkan setuid sandbox
                    '--disable-dev-shm-usage', // Mengatasi masalah resource di /dev/shm
                    '--disable-gpu', // Menonaktifkan akselerasi GPU (sering tidak perlu/bermasalah di server)
                    '--no-first-run', // Lewati wizard setup pertama Chrome
                    '--no-zygote', // Menonaktifkan proses zygote
                    // '--single-process', // Gunakan HANYA jika resource sangat terbatas, dapat mempengaruhi stabilitas
                    '--disable-accelerated-2d-canvas' // Menonaktifkan akselerasi canvas 2D
                ],
                // `executablePath` bisa diset jika path Chrome/Chromium non-standar
                // executablePath: '/usr/bin/google-chrome-stable'
            },
            // Opsional: Tetapkan ID klien untuk sesi (berguna untuk multi-device)
            // clientId: 'my-queue-bot-session-1'
            // Opsional: Cache versi WhatsApp Web untuk konsistensi
            // webVersionCache: {
            //   type: 'remote',
            //   remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html', // Ganti URL jika perlu
            // },
        };
        // Buat instance Client
        this.client = new Client(clientOptions);
        // Setup event listener untuk client
        this.setupEventHandlers();
    }

    /** Menyiapkan listener untuk event-event penting dari whatsapp-web.js */
    private setupEventHandlers(): void {
        // Event: QR code diterima, tampilkan di terminal
        this.client.on('qr', (qr) => {
            logger.info('QR code received, please scan using WhatsApp on your phone.');
            qrcode.generate(qr, { small: true }); // Tampilkan QR code kecil di terminal
        });

        // Event: Client berhasil login dan siap digunakan
        this.client.on('ready', () => {
            this.isInitialized = true;
            // Dapatkan dan simpan WID (nomor WhatsApp) bot
            if (this.client.info?.wid) {
                this.botWID = this.client.info.wid._serialized || `${this.client.info.wid.user}@c.us`;
                logger.info(`WhatsApp Client is ready! Logged in as: ${this.botWID}`);
            } else {
                logger.error("CRITICAL: Could not get Bot WID after client ready!");
            }
            // Anda bisa menambahkan tindakan lain di sini setelah bot siap
            // misalnya mengirim pesan ke diri sendiri atau admin awal
        });

        // Event: Pesan baru diterima
        this.client.on('message_create', async (message: Message) => {
            // Abaikan update status
            if (message.isStatus) return;

            // Cek apakah pesan berasal dari bot itu sendiri (penting untuk multi-device)
            const isFromMe = message.fromMe;

            // Opsi: Abaikan pesan dari grup kecuali dari bot sendiri
            const fromGroup = message.from.endsWith('@g.us');
            if (fromGroup && !isFromMe) {
                logger.trace({ msgId: message.id.id, from: message.from }, "Ignoring user message from group");
                return;
            }

            // Dapatkan body pesan, tangani jika kosong
            const body = message.body?.trim() ?? '';
            // Abaikan jika tidak ada body teks (misal: gambar tanpa caption, video, dll)
            if (!body && message.type !== 'chat') {
                logger.trace({ msgId: message.id?.id, type: message.type }, "Ignoring non-text message");
                return;
            }

            // Log pesan yang diterima (potong body jika terlalu panjang)
            logger.debug({ from: message.from, fromMe: isFromMe, body: body.substring(0, 50) + '...', chatId: message.id.remote }, 'Received message');

            try {
                // Teruskan pesan dan status `isFromMe` ke message handler utama
                await messageHandler(this, message, isFromMe);
            } catch (error) {
                // Tangani error yang tidak tertangkap di dalam message handler
                logger.error({ err: error, messageId: message.id?.id }, 'Unhandled error in message handler');
                // Pertimbangkan untuk membalas pesan error ke pengirim atau chat asal
                // message.reply("Maaf, terjadi kesalahan sistem.").catch(()=>{});
            }
        });

        // Event: Gagal autentikasi (misal: sesi tidak valid)
        this.client.on('auth_failure', (msg) => {
            logger.error('AUTHENTICATION FAILURE:', msg);
            // Mungkin perlu tindakan pemulihan, seperti menghapus folder sesi
        });

        // Event: Client terputus atau logout
        this.client.on('disconnected', (reason) => {
            logger.warn('Client was disconnected:', reason);
            this.isInitialized = false; // Tandai client tidak siap
            this.botWID = null; // Reset WID bot
            // Tambahkan logika reconnect atau notifikasi jika perlu
        });

        // Event: Proses loading WhatsApp Web
        this.client.on('loading_screen', (percent, message) => {
            logger.info(`Loading WhatsApp Web: ${percent}% - ${message}`);
        });

        // Event lain bisa ditambahkan di sini sesuai kebutuhan (message_ack, message_create, etc.)
    }

    /** Memulai proses inisialisasi client WhatsApp. */
    public initialize(): void {
        if (this.isInitialized) {
            logger.warn('Client already initialized.');
            return;
        }
        logger.info('Starting WhatsApp client initialization...');
        // Panggil initialize() dari whatsapp-web.js
        this.client.initialize().catch(err => {
            // Tangani error fatal saat inisialisasi awal
            logger.fatal({ err }, "FATAL: Failed to initialize WhatsApp Client!");
            process.exit(1); // Hentikan aplikasi jika gagal init awal
        });
    }

    /**
     * Mengirim pesan WhatsApp.
     * @param to Tujuan pesan (format: 62...@c.us atau chatId).
     * @param message Isi pesan teks.
     * @returns Promise yang resolve ke objek Message jika berhasil, atau null jika gagal/client belum siap.
     */
    public async sendMessage(to: string, message: string): Promise<Message | null> {
        if (!this.isInitialized) {
            logger.error('Cannot send message, client is not ready.');
            return null;
        }
        if (!to || !message) {
            logger.warn('Attempted to send message with empty recipient or body.');
            return null;
        }
        try {
            // Log sebelum mengirim (potong pesan jika terlalu panjang)
            logger.debug({ to, message: message.substring(0, 50) + '...' }, 'Sending message');
            // Kirim pesan menggunakan client
            const sentMessage = await this.client.sendMessage(to, message.trim());
            // logger.info({ msgId: sentMessage.id.id, to }, 'Message sent successfully'); // Bisa terlalu verbose
            return sentMessage;
        } catch (error) {
            logger.error({ err: error, to }, 'Failed to send message');
            return null; // Kembalikan null jika gagal
        }
    }

    /**
     * Mendapatkan objek Chat berdasarkan ID chat.
     * @param chatId ID chat tujuan (e.g., 62...@c.us atau XXXXX@g.us).
     * @returns Promise yang resolve ke objek Chat atau null jika tidak ditemukan/error.
     */
    public async getChatById(chatId: string): Promise<Chat | null> {
        if (!this.isInitialized || !chatId) return null;
        try {
            // Dapatkan chat menggunakan client
            const chat = await this.client.getChatById(chatId);
            return chat;
        } catch (error) {
            // Log error jika chat tidak ditemukan atau masalah lain
            logger.error({ err: error, chatId }, 'Failed to get chat by ID');
            return null;
        }
    }

    /** Mendapatkan Contact berdasarkan ID. */
    public async getContactById(contactId: string): Promise<Contact | null> {
        if (!this.isInitialized || !contactId) return null;
        try {
            return await this.client.getContactById(contactId);
        } catch (error) {
            logger.error({ err: error, contactId }, 'Failed to get contact by ID');
            return null;
        }
    }

    /**
     * Mendapatkan WID (nomor WhatsApp) bot yang sedang login.
     * @returns String WID atau null jika client belum siap.
     */
    public getBotWID(): string | null {
        return this.botWID;
    }

    // Tambahkan fungsi helper lain sesuai kebutuhan (misal: kirim media, dll.)
}

// Export instance singleton dari WhatsAppService
export const whatsappService = new WhatsAppService();

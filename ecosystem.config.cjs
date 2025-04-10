module.exports = {
    apps: [
        {
            name: "bot-wa-antrian",
            script: "./dist/index.js",
            autorestart: true,
            max_memory_restart: "600M",
        },
    ],
};

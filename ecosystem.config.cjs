module.exports = {
    apps: [
        {
            name: "bot-wa-km",
            script: "npm",
            args: "start",
            autorestart: true,
            max_memory_restart: "500M",
        },
    ],
};

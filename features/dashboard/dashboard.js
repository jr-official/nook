// features/dashboard/dashboard.js
// Web dashboard API for the Nook website. See README.md in this folder.
const { Events } = require('discord.js');
const cfg = require('./config/dashboardConfig');
const sessionService = require('./services/sessionService');
const { createServer } = require('./server');

module.exports = (client) => {
    if (!cfg.isConfigured()) {
        console.warn('⚠️  [dashboard] DISCORD_CLIENT_SECRET / DASHBOARD_PUBLIC_URL / DASHBOARD_ORIGIN not all set — dashboard API is DISABLED');
        return;
    }

    client.once(Events.ClientReady, async () => {
        try { await sessionService.ensureIndexes(); }
        catch (err) { console.error('❌ [dashboard] Failed to create indexes:', err); }
    });

    const server = createServer(client);
    server.on('error', err => console.error('❌ [dashboard] HTTP server error:', err.message));
    server.listen(cfg.PORT, () => console.log(`🌐 Dashboard API listening on :${cfg.PORT} (origins: ${cfg.ORIGINS.join(', ')})`));
};

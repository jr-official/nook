// features/dashboard/config/dashboardConfig.js
//
// Web dashboard API. The feature is DISABLED (fails closed) unless all three required
// variables are set.
//
// Required (Railway → Variables):
//   DISCORD_CLIENT_SECRET   OAuth2 client secret   (Discord Developer Portal → OAuth2)
//   DASHBOARD_PUBLIC_URL    public https URL of THIS service, no trailing slash
//                           (Railway → Settings → Networking → Generate Domain)
//   DASHBOARD_ORIGIN        website origin(s) allowed to call the API; comma separated
//                           e.g. https://jrofficial.org,https://www.jrofficial.org
// Optional:
//   DISCORD_CLIENT_ID       defaults to the bot's own application id
//   DASHBOARD_SITE_URL      where login redirects back to (default: first DASHBOARD_ORIGIN)
//   DASHBOARD_INVITE_PERMISSIONS   permission integer for the "Add Nook" link (default below)
//   PORT                    set automatically by Railway

const { PermissionFlagsBits: P } = require('discord.js');

const clean = v => String(v || '').trim().replace(/\/+$/, '');
const origins = String(process.env.DASHBOARD_ORIGIN || '')
    .split(/[,\s]+/).map(clean).filter(o => /^https?:\/\//.test(o));

const DEFAULT_INVITE_PERMISSIONS = String(
    P.ViewChannel | P.SendMessages | P.EmbedLinks | P.AttachFiles | P.ReadMessageHistory | P.AddReactions |
    P.ManageRoles | P.ManageChannels | P.ManageMessages | P.KickMembers | P.BanMembers | P.ModerateMembers
);

module.exports = {
    CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET || '',
    CLIENT_ID_ENV: process.env.DISCORD_CLIENT_ID || '',
    PUBLIC_URL: clean(process.env.DASHBOARD_PUBLIC_URL),
    ORIGINS: origins,
    SITE_URL: clean(process.env.DASHBOARD_SITE_URL) || origins[0] || '',
    INVITE_PERMISSIONS: /^\d+$/.test(process.env.DASHBOARD_INVITE_PERMISSIONS || '') ? process.env.DASHBOARD_INVITE_PERMISSIONS : DEFAULT_INVITE_PERMISSIONS,
    PORT: parseInt(process.env.PORT, 10) || 3000,

    SESSION_DAYS: 7,
    STATE_MINUTES: 10,
    MAX_BODY_BYTES: 64 * 1024,
    RATE: { API_PER_MIN: 120, AUTH_PER_MIN: 20 },
    COLLECTIONS: { sessions: 'dashboard_sessions', states: 'dashboard_oauth_states' },

    isConfigured() {
        return !!(this.CLIENT_SECRET && this.PUBLIC_URL && this.ORIGINS.length);
    }
};

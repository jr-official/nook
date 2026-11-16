// features/moderation/config/moderationConfig.js
// All IDs are read from environment variables so the bot is portable
// and secrets are not hard-coded in source.
//
// Required .env keys:
//   MOD_LOGS_CHANNEL_ID   – text channel where moderation actions are logged

const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : d; };

module.exports = {
    MOD_LOGS_CHANNEL_ID: process.env.MOD_LOGS_CHANNEL_ID || '1385991704670244915',
    // Weighted warnings: staff are alerted in the mod log when a member's points reach this.
    WARN_POINT_THRESHOLD: int(process.env.WARN_POINT_THRESHOLD, 5),
    // Warnings older than this many days stop counting towards points (0 = never decay).
    WARN_DECAY_DAYS: int(process.env.WARN_DECAY_DAYS, 0)
};
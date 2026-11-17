// features/moderation/services/modSettingsService.js — moderation settings saved from the dashboard:
// warning points alert/decay, automatic escalation tiers, and which roles can still talk in locked channels.
// One document per server in `modsettings`, cached so synchronous code can read it.
// Defaults come from the old Railway variables (WARN_POINT_THRESHOLD / WARN_DECAY_DAYS) so nothing changes
// until something is saved on the dashboard.
const databaseService = require('../../tickets/services/databaseService');

const COLLECTION = 'modsettings';
const cache = new Map();
const col = () => databaseService.getCollection(COLLECTION);

const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : d; };
const LIMITS = { MAX_TIERS: 5, MAX_POINTS: 100, MAX_DECAY_DAYS: 365, MAX_STAFF_ROLES: 20, MUTE_MAX_MS: 28 * 86400000 };

const defaults = () => ({
    warnAlertPoints: int(process.env.WARN_POINT_THRESHOLD, 5),
    decayDays: int(process.env.WARN_DECAY_DAYS, 0),
    escalation: {
        enabled: false,                                   // off until switched on in the dashboard
        tiers: [
            { points: 3, action: 'mute', duration: '1h' },
            { points: 6, action: 'kick', duration: null },
            { points: 10, action: 'ban', duration: 'permanent' }
        ]
    },
    lockStaffRoles: []
});

function get(guildId) {
    const d = defaults(), s = cache.get(guildId);
    if (!s) return d;
    return {
        warnAlertPoints: s.warnAlertPoints ?? d.warnAlertPoints,
        decayDays: s.decayDays ?? d.decayDays,
        escalation: s.escalation ?? d.escalation,
        lockStaffRoles: s.lockStaffRoles ?? d.lockStaffRoles
    };
}

async function load() {
    try { for (const d of await col().find({}).toArray()) cache.set(d.guildId, d); }
    catch (e) { console.error('[moderation] could not load settings:', e.message); }
}

async function save(guildId, patch) {
    const next = { ...get(guildId), ...patch };
    await col().updateOne({ guildId }, { $set: { guildId, ...next, updatedAt: new Date() } }, { upsert: true });
    cache.set(guildId, { guildId, ...next });
    return get(guildId);
}

module.exports = { get, load, save, defaults, LIMITS };

// features/leveling/services/configService.js
// Per-guild leveling settings (collection `level_config`, one doc per guild).
// Reads are cached briefly; every write goes through update() which refreshes the cache.
const databaseService = require('../../tickets/services/databaseService');
const cfg = require('../config/levelingConfig');

const cache = new Map();   // guildId -> { at, value }

const col = () => databaseService.getCollection(cfg.COLLECTIONS.config);

function withDefaults(doc) {
    const d = cfg.DEFAULTS;
    return {
        guildId: doc?.guildId,
        enabled: doc?.enabled ?? d.enabled,
        xpMin: doc?.xpMin ?? d.xpMin,
        xpMax: doc?.xpMax ?? d.xpMax,
        cooldownSec: doc?.cooldownSec ?? d.cooldownSec,
        progression: { ...d.progression, ...(doc?.progression || {}) },
        announce: { ...d.announce, ...(doc?.announce || {}) },
        rewardMode: doc?.rewardMode === 'replace' ? 'replace' : 'stack',
        rewards: Array.isArray(doc?.rewards) ? doc.rewards : [],
        ignoredChannels: Array.isArray(doc?.ignoredChannels) ? doc.ignoredChannels : [],
        ignoredRoles: Array.isArray(doc?.ignoredRoles) ? doc.ignoredRoles : [],
        leaderboard: { public: doc?.leaderboard?.public === true, slug: typeof doc?.leaderboard?.slug === 'string' ? doc.leaderboard.slug : null }
    };
}

async function ensureIndexes() {
    await col().createIndex({ guildId: 1 }, { unique: true });
    // Public leaderboard link names are unique across servers (only enforced when a slug is set).
    await col().createIndex({ 'leaderboard.slug': 1 }, { unique: true, partialFilterExpression: { 'leaderboard.slug': { $type: 'string' } } });
}

async function get(guildId) {
    const hit = cache.get(guildId);
    if (hit && Date.now() - hit.at < cfg.CONFIG_CACHE_MS) return hit.value;
    const doc = await col().findOne({ guildId });
    const value = withDefaults({ ...doc, guildId });
    cache.set(guildId, { at: Date.now(), value });
    return value;
}

// `changes` is a flat object of top-level fields ($set) — e.g. { xpMin: 10, xpMax: 20 }.
// Arrays (rewards, ignored*) are always replaced whole, which keeps updates simple.
async function update(guildId, changes) {
    await col().updateOne({ guildId }, { $set: { ...changes, updatedAt: new Date() }, $setOnInsert: { guildId, createdAt: new Date() } }, { upsert: true });
    cache.delete(guildId);
    return get(guildId);
}

// Remove a deleted role / channel from stored settings (called from guild events).
async function pruneRole(guildId, roleId) {
    const c = await get(guildId);
    const changes = {};
    if (c.rewards.some(r => r.roleId === roleId)) changes.rewards = c.rewards.filter(r => r.roleId !== roleId);
    if (c.ignoredRoles.includes(roleId)) changes.ignoredRoles = c.ignoredRoles.filter(i => i !== roleId);
    if (Object.keys(changes).length) await update(guildId, changes);
}

async function pruneChannel(guildId, channelId) {
    const c = await get(guildId);
    const changes = {};
    if (c.ignoredChannels.includes(channelId)) changes.ignoredChannels = c.ignoredChannels.filter(i => i !== channelId);
    if (c.announce.channelId === channelId) changes.announce = { ...c.announce, channelId: null };
    if (Object.keys(changes).length) await update(guildId, changes);
}

// Finds a server whose leaderboard is public by its link name (or its id). Returns the config or null.
async function findPublic(key) {
    const filter = /^\d{15,25}$/.test(key) ? { guildId: key } : { 'leaderboard.slug': key };
    const doc = await col().findOne({ ...filter, 'leaderboard.public': true });
    return doc ? withDefaults(doc) : null;
}

module.exports = { ensureIndexes, get, update, findPublic, pruneRole, pruneChannel, _clearCache: () => cache.clear() };

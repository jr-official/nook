// features/logging/settingsService.js — log channels, event switches and ignored channels, saved from the
// dashboard. One document per server in `logsettings`; cached in memory so the log handlers stay synchronous.
// Precedence everywhere: dashboard setting > Railway variable > default.
const databaseService = require('../tickets/services/databaseService');

const COLLECTION = 'logsettings';
const cache = new Map();                      // guildId -> { channels, events, ignored }
const col = () => databaseService.getCollection(COLLECTION);
const blank = () => ({ channels: {}, events: {}, ignored: [] });

const KIND_KEYS = ['mod', 'member', 'joinleave', 'message', 'server', 'voice'];
const isSnowflake = v => typeof v === 'string' && /^\d{15,25}$/.test(v);

const get = guildId => cache.get(guildId) ?? blank();

async function load() {
    try {
        for (const d of await col().find({}).toArray()) cache.set(d.guildId, { channels: d.channels ?? {}, events: d.events ?? {}, ignored: d.ignored ?? [] });
    } catch (e) { console.error('[logging] could not load log settings:', e.message); }
}

// Merge a validated patch into the saved settings. `channels[kind] = null` goes back to automatic.
async function save(guildId, patch, validEvents) {
    const cur = get(guildId);
    const next = { channels: { ...cur.channels }, events: { ...cur.events }, ignored: [...cur.ignored] };
    if (patch.channels) for (const [k, v] of Object.entries(patch.channels)) { if (v === null) delete next.channels[k]; else next.channels[k] = v; }
    if (patch.events) for (const [k, v] of Object.entries(patch.events)) next.events[k] = v;
    if (patch.ignored) next.ignored = [...new Set(patch.ignored)];
    await col().updateOne({ guildId }, { $set: { guildId, ...next, updatedAt: new Date() } }, { upsert: true });
    cache.set(guildId, next);
    return next;
}

module.exports = { load, get, save, KIND_KEYS, isSnowflake };

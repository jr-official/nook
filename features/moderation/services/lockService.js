// features/moderation/services/lockService.js — lock and unlock channels.
// A lock denies @everyone from sending/starting threads, lets Nook and the staff roles chosen on the dashboard
// keep talking, and remembers each overwrite exactly as it was so unlock restores it.
const { PermissionFlagsBits: P } = require('discord.js');
const databaseService = require('../../tickets/services/databaseService');
const modSettings = require('./modSettingsService');

const COLLECTION = 'channellocks';
const col = () => databaseService.getCollection(COLLECTION);
const FLAGS = ['SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads', 'CreatePrivateThreads'];
const STAFF_FLAGS = ['SendMessages', 'SendMessagesInThreads'];

const snapshot = (channel, id) => {
    const ow = channel.permissionOverwrites.cache.get(id);
    const flags = {};
    for (const f of FLAGS) flags[f] = !ow ? null : ow.allow.has(P[f]) ? true : ow.deny.has(P[f]) ? false : null;
    return { existed: !!ow, flags };
};
const edit = (channel, id, flags, reason) => channel.permissionOverwrites.edit(id, flags, { reason });

const get = (guildId, channelId) => col().findOne({ guildId, channelId });
const list = guildId => col().find({ guildId }).sort({ lockedAt: -1 }).toArray();
const due = (now = new Date()) => col().find({ expiresAt: { $lte: now } }).limit(50).toArray();

async function ensureIndexes() {
    try { await col().createIndexes([{ key: { guildId: 1, channelId: 1 }, unique: true }, { key: { expiresAt: 1 } }]); }
    catch (e) { console.error('❌ Error creating lock indexes:', e); }
}

// Returns { ok, reason? }. `by` is { id, tag }.
async function lock(channel, { by, reason, expiresAt = null, lockdown = false }) {
    const guild = channel.guild;
    if (await get(guild.id, channel.id)) return { ok: false, reason: 'already_locked' };
    const everyone = guild.id;
    const staff = modSettings.get(guild.id).lockStaffRoles.filter(id => guild.roles.cache.has(id));
    const me = guild.members.me.id;
    const allowIds = [...new Set([me, ...staff])];
    const previous = { [everyone]: snapshot(channel, everyone) };
    for (const id of allowIds) previous[id] = snapshot(channel, id);
    const kinds = { [everyone]: 'role', [me]: 'member' }; for (const id of staff) kinds[id] = 'role';
    const doc = { guildId: guild.id, channelId: channel.id, previous, kinds, reason: String(reason ?? '').slice(0, 300), lockedBy: by.id, lockedByTag: by.tag, lockedAt: new Date(), expiresAt, lockdown };
    try { await col().insertOne(doc); } catch (e) { if (e.code === 11000) return { ok: false, reason: 'already_locked' }; throw e; }
    const done = [];
    try {
        for (const id of allowIds) { await edit(channel, id, Object.fromEntries(STAFF_FLAGS.map(f => [f, true])), 'Channel lock: staff may talk'); done.push(id); }
        await edit(channel, everyone, Object.fromEntries(FLAGS.map(f => [f, false])), `Channel lock by ${by.tag}: ${doc.reason || 'no reason'}`); done.push(everyone);
    } catch (e) {
        await restore(channel, doc, done).catch(() => {});
        await col().deleteOne({ guildId: guild.id, channelId: channel.id });
        return { ok: false, reason: 'failed', error: e.message };
    }
    return { ok: true, doc };
}

async function restore(channel, doc, only) {
    for (const [id, snap] of Object.entries(doc.previous)) {
        if (only && !only.includes(id)) continue;
        if (!snap.existed) { try { await channel.permissionOverwrites.delete(id, 'Channel unlocked'); } catch { /* already gone */ } continue; }
        await edit(channel, id, snap.flags, 'Channel unlocked');
    }
}

async function unlock(channel, { reason = 'Channel unlocked' } = {}) {
    const guild = channel.guild;
    const doc = await get(guild.id, channel.id);
    if (!doc) return { ok: false, reason: 'not_locked' };
    try { await restore(channel, doc); }
    catch (e) { return { ok: false, reason: 'failed', error: e.message }; }
    await col().deleteOne({ guildId: guild.id, channelId: channel.id });
    return { ok: true, doc };
}

// Drop the record when the channel itself is gone.
const forget = (guildId, channelId) => col().deleteOne({ guildId, channelId });

module.exports = { lock, unlock, get, list, due, forget, ensureIndexes, FLAGS };

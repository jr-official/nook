// features/dashboard/api/loggingApi.js — the Logging page: where each log goes, which events are logged,
// and which channels are ignored. Saved settings override Railway variables and defaults.
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const settings = require('../../logging/settingsService');
const logCfg = require('../../logging/config');
const { HttpError } = require('../services/guildAccess');

const bad = msg => new HttpError(400, 'invalid', msg);
const TEXT = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
const IGNORABLE = new Set([...TEXT, ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildForum, ChannelType.GuildCategory]);
const MAX_IGNORED = 100;

const KIND_INFO = {
    mod:       ['Moderation log', 'Bans, kicks, mutes, warnings, purges and alerts'],
    member:    ['Member log', 'Role, name and avatar changes'],
    joinleave: ['Join/leave log', 'Members joining and leaving'],
    message:   ['Message log', 'Deleted, edited and purged messages'],
    server:    ['Server log', 'Channels, roles, threads, emoji and server settings'],
    voice:     ['Voice log', 'Joining, moving and leaving voice']
};

function view(guild) {
    const me = guild.members.me;
    const s = settings.get(guild.id);
    const chans = [...guild.channels.cache.values()].filter(c => IGNORABLE.has(c.type))
        .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0))
        .map(c => ({
            id: c.id, name: c.name, kind: TEXT.has(c.type) ? 'text' : c.type === ChannelType.GuildCategory ? 'category' : c.type === ChannelType.GuildForum ? 'forum' : 'voice',
            canSend: TEXT.has(c.type) && !!me && !!c.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])
        }));
    const kinds = settings.KIND_KEYS.map(k => {
        const own = logCfg.direct(guild, k);                  // saved, Railway or name match for this log
        const effective = own ?? logCfg.logChannel(guild, k); // after fallbacks (e.g. voice -> member)
        return {
            kind: k, label: KIND_INFO[k][0], description: KIND_INFO[k][1],
            channelId: s.channels[k] ?? null,                 // what was chosen on this page (null = automatic)
            automatic: own ? { id: own.id, name: own.name } : null,
            effective: effective ? { id: effective.id, name: effective.name } : null
        };
    });
    const groups = logCfg.GROUPS.map(g => ({ title: g.title, events: g.events.map(e => ({ key: e.key, label: e.label, on: logCfg.eventOn(e.key, guild) })) }));
    return { channels: chans, kinds, groups, ignored: s.ignored };
}

async function getLogging({ guild }) { return view(guild); }

async function putLogging({ guild, body }) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('Send a JSON object.');
    for (const k of Object.keys(body)) if (!['channels', 'events', 'ignored'].includes(k)) throw bad(`Unknown setting "${k}".`);
    const patch = {};
    if (body.channels !== undefined) {
        if (!body.channels || typeof body.channels !== 'object' || Array.isArray(body.channels)) throw bad('channels must be an object.');
        patch.channels = {};
        for (const [k, v] of Object.entries(body.channels)) {
            if (!settings.KIND_KEYS.includes(k)) throw bad(`Unknown log "${k}".`);
            if (v === null) { patch.channels[k] = null; continue; }
            if (!settings.isSnowflake(v)) throw bad('Pick a channel from the list.');
            const ch = guild.channels.cache.get(v);
            if (!ch || !TEXT.has(ch.type)) throw bad('That channel isn’t a text channel in this server.');
            patch.channels[k] = v;
        }
    }
    if (body.events !== undefined) {
        if (!body.events || typeof body.events !== 'object' || Array.isArray(body.events)) throw bad('events must be an object.');
        patch.events = {};
        for (const [k, v] of Object.entries(body.events)) {
            if (!logCfg.EVENT_KEYS.has(k)) throw bad(`Unknown event "${k}".`);
            if (typeof v !== 'boolean') throw bad(`Event "${k}" must be true or false.`);
            patch.events[k] = v;
        }
    }
    if (body.ignored !== undefined) {
        if (!Array.isArray(body.ignored) || body.ignored.length > MAX_IGNORED) throw bad(`ignored must be a list of up to ${MAX_IGNORED} channels.`);
        for (const id of body.ignored) {
            if (!settings.isSnowflake(id)) throw bad('Pick channels from the list.');
            const ch = guild.channels.cache.get(id);
            if (!ch || !IGNORABLE.has(ch.type)) throw bad('One of those channels doesn’t exist in this server.');
        }
        patch.ignored = body.ignored;
    }
    await settings.save(guild.id, patch);
    console.log(`\u{1F4DC} [dashboard] logging settings saved in guild ${guild.id}`);
    return view(guild);
}

module.exports = { getLogging, putLogging };

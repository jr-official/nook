// features/logging/config.js
// Log channels and which events are logged. Everything here can be set in Railway; without the
// *_LOGS_CHANNEL_ID variables Nook looks for a text channel named like "member-logs" etc.
//
// Channel fallbacks (same idea as CarlBot): join/leave -> member -> mod, voice -> member -> mod,
// server -> mod, message -> mod.
const { ChannelType } = require('discord.js');
const { MOD_LOGS_CHANNEL_ID } = require('../moderation/config/moderationConfig');
const settings = require('./settingsService');

const KINDS = {
    mod:       { env: 'MOD_LOGS_CHANNEL_ID',       names: ['modlog', 'auditlog'],                                   fallback: null,     id: MOD_LOGS_CHANNEL_ID },
    member:    { env: 'MEMBER_LOGS_CHANNEL_ID',    names: ['memberlog'],                                            fallback: 'mod' },
    joinleave: { env: 'JOINLEAVE_LOGS_CHANNEL_ID', names: ['fluctuation', 'joinleave', 'joinlog', 'welcomelog'],    fallback: 'member' },
    message:   { env: 'MESSAGE_LOGS_CHANNEL_ID',   names: ['messagelog', 'msglog'],                                 fallback: 'mod' },
    server:    { env: 'SERVER_LOGS_CHANNEL_ID',    names: ['serverlog'],                                            fallback: 'mod' },
    voice:     { env: 'VOICE_LOGS_CHANNEL_ID',     names: ['voicelog', 'vclog'],                                    fallback: 'member' }
};
const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const warned = new Set();
const list = v => new Set(String(v ?? '').split(/[\s,]+/).map(s => s.trim()).filter(Boolean));

const isSendable = ch => !!ch && ch.type !== ChannelType.GuildVoice && typeof ch.isTextBased === 'function' && ch.isTextBased() && typeof ch.send === 'function';

function direct(guild, kind) {
    const k = KINDS[kind];
    const id = settings.get(guild.id).channels[kind] || process.env[k.env] || k.id;
    let ch = id ? guild.channels.cache.get(id) : null;
    if (!isSendable(ch)) ch = guild.channels.cache.find?.(c => isSendable(c) && k.names.some(n => norm(c.name).includes(n)));
    return isSendable(ch) ? ch : null;
}

function logChannel(guild, kind) {
    for (let k = kind; k; k = KINDS[k].fallback) {
        const ch = direct(guild, k);
        if (ch) return ch;
    }
    if (!warned.has(kind)) { warned.add(kind); console.warn(`[logging] No channel for ${kind} logs. Set ${KINDS[kind].env} in Railway.`); }
    return null;
}

// Channels whose own messages must never be logged (it would loop and add noise).
function isLogChannelId(guild, id) {
    if (!id) return false;
    return Object.keys(KINDS).some(k => (settings.get(guild.id).channels[k] || process.env[KINDS[k].env] || KINDS[k].id) === id || direct(guild, k)?.id === id);
}

// ---- event switches ----
// Every event, grouped like CarlBot's page. Off by default (noisy): threads and avatar changes.
// Precedence: dashboard setting > LOG_EVENTS_ON / LOG_EVENTS_OFF (Railway) > default.
const GROUPS = [
    { title: 'Message events', events: [['msg_delete', 'Deleted messages'], ['msg_edit', 'Edited messages'], ['msg_purge', 'Purged messages']] },
    { title: 'Members joining and leaving', events: [['member_join', 'Members joining'], ['member_leave', 'Members leaving']] },
    { title: 'Member events', events: [['role_change', 'Role updates'], ['name_change', 'Name changes'], ['avatar_change', 'Avatar changes']] },
    { title: 'Server events', events: [['channel_create', 'Channel creation'], ['channel_update', 'Updated channel'], ['channel_delete', 'Channel deletion'],
        ['thread_create', 'Thread creation'], ['thread_update', 'Updated thread'], ['thread_delete', 'Thread deletion'],
        ['role_create', 'Role creation'], ['role_update', 'Role updates'], ['role_delete', 'Role deletion'],
        ['server_update', 'Server updates'], ['emoji_change', 'Emoji changes']] },
    { title: 'Voice events', events: [['voice_join', 'Join voice channel'], ['voice_move', 'Move between voice channels'], ['voice_leave', 'Leave voice channel']] }
].map(g => ({ title: g.title, events: g.events.map(([key, label]) => ({ key, label })) }));
const EVENT_KEYS = new Set(GROUPS.flatMap(g => g.events.map(e => e.key)));

const DEFAULT_OFF = new Set(['thread_create', 'thread_update', 'thread_delete', 'avatar_change']);
function eventOn(key, guild) {
    const saved = guild ? settings.get(guild.id).events[key] : undefined;
    if (typeof saved === 'boolean') return saved;
    if (list(process.env.LOG_EVENTS_ON).has(key)) return true;
    if (list(process.env.LOG_EVENTS_OFF).has(key)) return false;
    return !DEFAULT_OFF.has(key);
}

// Channels (or categories) that are never logged for messages and voice.
// Saved in the dashboard, plus LOG_IGNORED_CHANNEL_IDS from Railway.
const isIgnored = (guild, ...ids) => {
    const ig = new Set([...list(process.env.LOG_IGNORED_CHANNEL_IDS), ...settings.get(guild.id).ignored]);
    return ids.some(i => i && ig.has(i));
};

async function send(guild, kind, embed, extra = {}) {
    const ch = logChannel(guild, kind);
    if (ch) await ch.send({ embeds: [embed], allowedMentions: { parse: [] }, ...extra });
}

module.exports = { direct, logChannel, isLogChannelId, isSendable, eventOn, isIgnored, send, KINDS, GROUPS, EVENT_KEYS };

// features/logging/config.js
// Where member and message logs go. Set MEMBER_LOGS_CHANNEL_ID / MESSAGE_LOGS_CHANNEL_ID in Railway;
// without them the bot looks for a text channel named like "member-logs" / "message-logs".
const { ChannelType } = require('discord.js');
const { MOD_LOGS_CHANNEL_ID } = require('../moderation/config/moderationConfig');

const KINDS = {
    member:  { env: 'MEMBER_LOGS_CHANNEL_ID',  names: ['memberlog', 'joinlog', 'joinleave', 'memberlogs'] },
    message: { env: 'MESSAGE_LOGS_CHANNEL_ID', names: ['messagelog', 'msglog', 'messagelogs', 'msglogs'] }
};
const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const warned = new Set();

function isSendable(ch) { return !!ch && ch.type !== ChannelType.GuildVoice && typeof ch.isTextBased === 'function' && ch.isTextBased() && typeof ch.send === 'function'; }

function logChannel(guild, kind) {
    const k = KINDS[kind];
    const id = process.env[k.env];
    let ch = id ? guild.channels.cache.get(id) : null;
    if (!isSendable(ch)) {
        ch = guild.channels.cache.find?.(c => isSendable(c) && k.names.some(n => norm(c.name).includes(n)));
    }
    if (!isSendable(ch)) {
        if (!warned.has(kind)) { warned.add(kind); console.warn(`[logging] No ${kind} log channel. Set ${k.env} in Railway.`); }
        return null;
    }
    return ch;
}

// Channels whose own messages must never be logged (it would loop and add noise).
function isLogChannelId(guild, id) {
    if (!id) return false;
    if (id === MOD_LOGS_CHANNEL_ID) return true;
    return Object.keys(KINDS).some(k => process.env[KINDS[k].env] === id || logChannel(guild, k)?.id === id);
}

module.exports = { logChannel, isLogChannelId, isSendable };

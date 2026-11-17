// features/logging/messageLog.js — deleted, edited and bulk-deleted messages.
const { Events, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { logChannel, isLogChannelId, eventOn, isIgnored } = require('./config');
const { findAudit, AuditLogEvent } = require('./auditService');

const cut = (s, n = 1000) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const NO_PING = { parse: [] };

function describe(msg) {
    const lines = [];
    if (msg.content) lines.push(cut(msg.content, 1500));
    const files = msg.attachments?.size ? [...msg.attachments.values()].map(a => a.name || a.url) : [];
    if (files.length) lines.push(`Attachments: ${files.join(', ')}`);
    return lines.join('\n') || null;
}

function register(client) {
    client.on(Events.MessageDelete, async msg => {
        try {
            if (!eventOn('msg_delete') || !msg.guild || msg.author?.bot || isLogChannelId(msg.guild, msg.channelId) || isIgnored(msg.channelId, msg.channel?.parentId)) return;
            const ch = logChannel(msg.guild, 'message'); if (!ch) return;
            const body = describe(msg);
            const e = new EmbedBuilder().setColor('#ff5555').setTitle('🗑️ Message deleted').setTimestamp()
                .addFields({ name: 'Channel', value: `<#${msg.channelId}>`, inline: true });
            if (msg.author) {
                e.setAuthor({ name: msg.author.tag, iconURL: msg.author.displayAvatarURL?.() ?? undefined });
                e.addFields({ name: 'Author', value: `<@${msg.author.id}> (${msg.author.id})`, inline: true });
            }
            if (msg.createdTimestamp) e.addFields({ name: 'Sent', value: `<t:${Math.floor(msg.createdTimestamp / 1000)}:R>`, inline: true });
            // Deleted by someone else? Self-deletes leave no audit entry, so this only shows for moderator deletes.
            if (msg.author) {
                const entry = await findAudit(msg.guild, AuditLogEvent.MessageDelete, msg.author.id, { windowMs: 8000, delayMs: 1200 });
                if (entry?.executor && (!entry.extra?.channel || entry.extra.channel.id === msg.channelId)) {
                    e.addFields({ name: 'Deleted by', value: `<@${entry.executor.id}> (${entry.executor.id})`, inline: true });
                }
            }
            e.setDescription(body ?? '*Content unavailable: the message was sent before Nook saw it.*');
            e.setFooter({ text: `${msg.author ? `User ID: ${msg.author.id} · ` : ''}Message ID: ${msg.id ?? 'unknown'}` });
            await ch.send({ embeds: [e], allowedMentions: NO_PING });
        } catch (err) { console.error('[logging] messageDelete:', err.message); }
    });

    client.on(Events.MessageUpdate, async (before, after) => {
        try {
            if (!eventOn('msg_edit') || !after.guild || after.author?.bot || isLogChannelId(after.guild, after.channelId) || isIgnored(after.channelId, after.channel?.parentId)) return;
            if (before.partial || before.content == null || after.content == null || before.content === after.content) return;
            const ch = logChannel(after.guild, 'message'); if (!ch) return;
            const e = new EmbedBuilder().setColor('#f0b232').setTitle('✏️ Message edited').setTimestamp()
                .setAuthor({ name: after.author?.tag ?? 'Unknown', iconURL: after.author?.displayAvatarURL?.() ?? undefined })
                .addFields(
                    { name: 'Author', value: `${after.author?.tag ?? 'Unknown'} (${after.author?.id ?? '?'})`, inline: true },
                    { name: 'Channel', value: `<#${after.channelId}> · [Jump](${after.url})`, inline: true },
                    { name: 'Before', value: cut(before.content) || '*empty*' },
                    { name: 'After', value: cut(after.content) || '*empty*' }
                ).setFooter({ text: `Message ID: ${after.id}` });
            await ch.send({ embeds: [e], allowedMentions: NO_PING });
        } catch (err) { console.error('[logging] messageUpdate:', err.message); }
    });

    client.on(Events.MessageBulkDelete, async (messages, channel) => {
        try {
            const guild = channel.guild; if (!eventOn('msg_purge') || !guild || isLogChannelId(guild, channel.id) || isIgnored(channel.id, channel.parentId)) return;
            const ch = logChannel(guild, 'message'); if (!ch) return;
            const list = [...messages.values()].sort((a, b) => (a.createdTimestamp ?? 0) - (b.createdTimestamp ?? 0));
            const known = list.filter(m => m.content != null || m.author);
            const e = new EmbedBuilder().setColor('#ff5555').setTitle('🧹 Messages bulk deleted').setTimestamp()
                .addFields({ name: 'Channel', value: `<#${channel.id}>`, inline: true }, { name: 'Count', value: `${messages.size}`, inline: true })
                .setFooter({ text: `${known.length} of ${messages.size} were still in Nook's cache; they're in the attached transcript.` });
            const payload = { embeds: [e], allowedMentions: NO_PING };
            if (known.length) {
                const text = known.map(m => `[${new Date(m.createdTimestamp).toISOString()}] ${m.author?.tag ?? 'unknown'} (${m.author?.id ?? '?'}): ${m.content ?? ''}${m.attachments?.size ? ' ' + [...m.attachments.values()].map(a => a.url).join(' ') : ''}`).join('\n');
                payload.files = [new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: `purged-${channel.id}.txt` })];
            }
            await ch.send(payload);
        } catch (err) { console.error('[logging] bulkDelete:', err.message); }
    });
}

module.exports = { register };

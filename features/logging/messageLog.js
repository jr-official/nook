// features/logging/messageLog.js — deleted, edited and bulk-deleted messages.
const { Events, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { logChannel, isLogChannelId } = require('./config');

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
            if (!msg.guild || msg.author?.bot || isLogChannelId(msg.guild, msg.channelId)) return;
            const ch = logChannel(msg.guild, 'message'); if (!ch) return;
            const body = describe(msg);
            const e = new EmbedBuilder().setColor('#ff5555').setTitle('🗑️ Message deleted').setTimestamp()
                .addFields({ name: 'Channel', value: `<#${msg.channelId}>`, inline: true });
            if (msg.author) e.addFields({ name: 'Author', value: `${msg.author.tag} (${msg.author.id})`, inline: true });
            e.setDescription(body ?? '*Content unavailable: the message was sent before Nook saw it.*');
            if (msg.id) e.setFooter({ text: `Message ID: ${msg.id}` });
            await ch.send({ embeds: [e], allowedMentions: NO_PING });
        } catch (err) { console.error('[logging] messageDelete:', err.message); }
    });

    client.on(Events.MessageUpdate, async (before, after) => {
        try {
            if (!after.guild || after.author?.bot || isLogChannelId(after.guild, after.channelId)) return;
            if (before.partial || before.content == null || after.content == null || before.content === after.content) return;
            const ch = logChannel(after.guild, 'message'); if (!ch) return;
            const e = new EmbedBuilder().setColor('#f0b232').setTitle('✏️ Message edited').setTimestamp()
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
            const guild = channel.guild; if (!guild || isLogChannelId(guild, channel.id)) return;
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

// features/moderation/commands/purge.js — /purge <count> and /purgeuntil <message link>
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const purge = require('../services/purgeService');
const { logModeration } = require('../utils/moderationUtils');

async function run(guild, channel, moderatorUser, summary, collected) {
    const messages = collected.messages;
    if (!messages.length) return { text: '❌ Nothing to delete. Messages older than 14 days and pinned messages can’t be purged.' };
    const deleted = await purge.deleteAll(channel, messages);
    await logModeration(guild, {
        type: 'purge', target: { id: channel.id, tag: `#${channel.name}` }, moderator: moderatorUser,
        reason: summary, count: deleted
    });
    const notes = [];
    if (collected.truncated) notes.push(`Stopped at ${purge.MAX_UNTIL} messages; run it again for the rest.`);
    if (deleted < messages.length) notes.push(`${messages.length - deleted} could not be deleted.`);
    return { text: `🧹 Deleted **${deleted}** message${deleted === 1 ? '' : 's'}.${notes.length ? '\n' + notes.join(' ') : ''}` };
}

function checkChannel(guild, channel) {
    if (!channel?.isTextBased?.() || !channel.bulkDelete) return 'Run this in a server text channel.';
    const me = channel.permissionsFor(guild.members.me);
    if (!me?.has(PermissionFlagsBits.ManageMessages) || !me.has(PermissionFlagsBits.ReadMessageHistory)) return 'I need Manage Messages and Read Message History in this channel.';
    return null;
}

const purgeCmd = {
    name: 'purge',
    description: 'Delete the latest messages in this channel',
    slashCommand: new SlashCommandBuilder().setName('purge').setDescription('Delete the latest messages in this channel')
        .addIntegerOption(o => o.setName('count').setDescription(`How many messages (1-${purge.MAX_COUNT})`).setMinValue(1).setMaxValue(purge.MAX_COUNT).setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    async exec(guild, channel, user, count) {
        const err = checkChannel(guild, channel); if (err) return { text: `❌ ${err}` };
        return run(guild, channel, user, `Purged the last ${count} messages in #${channel.name}`, { messages: await purge.collectLast(channel, count) });
    },
    async executeSlash(i) {
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        const r = await this.exec(i.guild, i.channel, i.user, i.options.getInteger('count'));
        return i.editReply(r.text);
    },
    async executePrefix(m, args) {
        const n = /^\d{1,3}$/.test(args[0] ?? '') ? Number(args[0]) : 0;
        if (n < 1 || n > purge.MAX_COUNT) return m.reply(`❌ **Usage:** \`!purge <1-${purge.MAX_COUNT}>\``);
        const r = await this.exec(m.guild, m.channel, m.author, n);
        await m.delete().catch(() => {});
        const note = await m.channel.send(r.text).catch(() => null);
        if (note) setTimeout(() => note.delete().catch(() => {}), 6000).unref();
    }
};

const purgeUntilCmd = {
    name: 'purgeuntil',
    description: 'Delete every message from a message link (inclusive) to now',
    slashCommand: new SlashCommandBuilder().setName('purgeuntil').setDescription('Delete every message from a message link (inclusive) up to now')
        .addStringOption(o => o.setName('message_link').setDescription('Link to the oldest message to delete (copy message link)').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    async exec(guild, channel, user, link) {
        const err = checkChannel(guild, channel); if (err) return { text: `❌ ${err}` };
        const p = purge.parseMessageLink(link);
        if (!p) return { text: '❌ That isn’t a message link. Right-click a message, then Copy Message Link.' };
        if (p.guildId !== guild.id) return { text: '❌ That message is in a different server.' };
        if (p.channelId !== channel.id) return { text: '❌ Run this in the same channel as the message.' };
        const c = await purge.collectUntil(channel, p.messageId);
        if (c.notFound) return { text: '❌ I couldn’t find that message.' };
        if (c.tooOld) return { text: '❌ That message is older than 14 days. Discord only lets bots bulk-delete newer messages.' };
        return run(guild, channel, user, `Purged from message ${p.messageId} (inclusive) in #${channel.name}`, c);
    },
    async executeSlash(i) {
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        const r = await this.exec(i.guild, i.channel, i.user, i.options.getString('message_link'));
        return i.editReply(r.text);
    },
    async executePrefix(m, args) {
        if (!args[0]) return m.reply('❌ **Usage:** `!purgeuntil <message link>`');
        const r = await this.exec(m.guild, m.channel, m.author, args[0]);
        await m.delete().catch(() => {});
        const note = await m.channel.send(r.text).catch(() => null);
        if (note) setTimeout(() => note.delete().catch(() => {}), 6000).unref();
    }
};

module.exports = { purgeCmd, purgeUntilCmd };

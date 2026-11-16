// features/moderation/commands/case.js — look up cases in the moderation database.
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const caseService = require('../services/caseService');

const ICON = { ban: '🔨', softban: '🔨', unban: '🔓', kick: '👢', mute: '🔇', unmute: '🔊', warn: '⚠️', warn_remove: '🗑️' };
const ts = d => `<t:${Math.floor(new Date(d).getTime() / 1000)}:f>`;
const cut = (s, n) => (String(s ?? '').length > n ? String(s).slice(0, n - 1) + '…' : String(s ?? ''));

function caseEmbed(c) {
    const e = new EmbedBuilder().setColor(c.active ? '#ff5555' : '#5865f2').setTitle(`${ICON[c.type] ?? '•'} ${c.caseId}`)
        .addFields(
            { name: 'Type', value: c.type.replace('_', ' '), inline: true },
            { name: 'Member', value: `${c.username ?? 'Unknown'} (${c.userId})`, inline: true },
            { name: 'Moderator', value: `${c.moderatorTag ?? 'Unknown'}`, inline: true },
            { name: 'Reason', value: cut(c.reason || 'No reason recorded', 1000) }
        ).setTimestamp(new Date(c.createdAt));
    if (c.duration) e.addFields({ name: 'Duration', value: c.duration, inline: true });
    if (c.expiresAt) e.addFields({ name: c.active ? 'Expires' : 'Expired', value: ts(c.expiresAt), inline: true });
    if (c.active) e.addFields({ name: 'Status', value: 'Active', inline: true });
    if (c.liftedAt) e.addFields({ name: 'Lifted', value: `${ts(c.liftedAt)} (${c.liftedReason ?? 'manual'}${c.liftedByCase ? `, ${c.liftedByCase}` : ''})`, inline: false });
    if (c.proof?.url) e.addFields({ name: 'Evidence', value: cut(c.proof.url, 500) });
    return e;
}

function historyEmbed(user, rows) {
    const lines = rows.slice(0, 15).map(c => `${ICON[c.type] ?? '•'} \`${c.caseId}\` ${ts(c.createdAt)}${c.active ? ' **active**' : ''}\n> ${cut(c.reason || 'No reason recorded', 90)}`);
    return new EmbedBuilder().setColor('#5865f2').setTitle(`History for ${user.tag ?? user.username}`)
        .setDescription(lines.length ? lines.join('\n') : 'No cases on record.')
        .setFooter({ text: rows.length > 15 ? `Showing 15 of ${rows.length} (latest first)` : `${rows.length} case${rows.length === 1 ? '' : 's'}` });
}

module.exports = {
    name: 'case',
    description: 'Look up moderation cases',
    slashCommand: new SlashCommandBuilder()
        .setName('case').setDescription('Look up moderation cases')
        .addSubcommand(s => s.setName('view').setDescription('Show one case')
            .addStringOption(o => o.setName('id').setDescription('Case ID, e.g. BAN-A3X9KQ').setRequired(true)))
        .addSubcommand(s => s.setName('history').setDescription('Every case for a member')
            .addUserOption(o => o.setName('user').setDescription('The member').setRequired(true)))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async executeSlash(i) {
        if (i.options.getSubcommand() === 'view') {
            const c = await caseService.get(i.guild.id, i.options.getString('id').trim());
            if (!c) return i.reply({ content: '❌ No case with that ID in this server.', flags: MessageFlags.Ephemeral });
            return i.reply({ embeds: [caseEmbed(c)], flags: MessageFlags.Ephemeral });
        }
        const user = i.options.getUser('user');
        return i.reply({ embeds: [historyEmbed(user, await caseService.forUser(i.guild.id, user.id, 100))], flags: MessageFlags.Ephemeral });
    },

    async executePrefix(m, args) {
        if (!args[0]) return m.reply('❌ **Usage:** `!case <case id>`');
        const c = await caseService.get(m.guild.id, args[0]);
        return m.reply(c ? { embeds: [caseEmbed(c)] } : '❌ No case with that ID in this server.');
    },
    caseEmbed, historyEmbed
};

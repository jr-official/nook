// features/moderation/commands/lock.js — /lock, /unlock, /lockdown, /unlockdown
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, MessageFlags } = require('discord.js');
const lockService = require('../services/lockService');
const { parseDuration, formatDuration } = require('../utils/durationParser');

const TEXT = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const isText = c => c && TEXT.includes(c.type);
const MAX_LOCK_MS = 30 * 86400000, MAX_LOCKDOWN = 150;
const ts = d => `<t:${Math.floor(new Date(d).getTime() / 1000)}:R>`;

async function modLog(guild, embed) {
    try { const { send } = require('../../logging/config'); await send(guild, 'mod', embed.setTimestamp()); } catch { /* never block the action */ }
}

function botCan(channel) {
    const p = channel.permissionsFor(channel.guild.members.me);
    return !!p && p.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageRoles]);
}

// Lock one channel, announce it and log it. Returns { ok, text }.
async function doLock(channel, by, reason, expiresAt, lockdown = false) {
    if (!isText(channel)) return { ok: false, text: 'That isn’t a text channel.' };
    if (!botCan(channel)) return { ok: false, text: `I need **Manage Roles**, **View Channel** and **Send Messages** in <#${channel.id}>.` };
    const r = await lockService.lock(channel, { by, reason, expiresAt, lockdown });
    if (!r.ok) return { ok: false, text: r.reason === 'already_locked' ? `<#${channel.id}> is already locked.` : `Couldn’t lock <#${channel.id}>: ${r.error}` };
    if (!lockdown) {
        await channel.send({ embeds: [new EmbedBuilder().setColor('#ff5555').setTitle('🔒 Channel locked').setDescription(`${reason ? `${reason}\n\n` : ''}Members can’t send messages here right now.${expiresAt ? ` It unlocks ${ts(expiresAt)}.` : ''}`)] }).catch(() => {});
        await modLog(channel.guild, new EmbedBuilder().setColor('#ff5555').setTitle('🔒 Channel locked').addFields(
            { name: 'Channel', value: `<#${channel.id}>`, inline: true }, { name: 'Moderator', value: `${by.tag} (${by.id})`, inline: true },
            { name: 'Reason', value: reason || 'No reason given' }, ...(expiresAt ? [{ name: 'Unlocks', value: ts(expiresAt), inline: true }] : [])));
    }
    return { ok: true, text: `🔒 Locked <#${channel.id}>${expiresAt ? `, unlocks ${ts(expiresAt)}` : ''}.` };
}

async function doUnlock(channel, by, { announce = true, log = true } = {}) {
    const r = await lockService.unlock(channel);
    if (!r.ok) return { ok: false, text: r.reason === 'not_locked' ? `<#${channel.id}> isn’t locked.` : `Couldn’t unlock <#${channel.id}>: ${r.error}` };
    if (announce) await channel.send({ embeds: [new EmbedBuilder().setColor('#43b581').setTitle('🔓 Channel unlocked').setDescription('You can send messages here again.')] }).catch(() => {});
    if (log) await modLog(channel.guild, new EmbedBuilder().setColor('#43b581').setTitle('🔓 Channel unlocked').addFields(
        { name: 'Channel', value: `<#${channel.id}>`, inline: true }, { name: 'By', value: `${by.tag} (${by.id})`, inline: true }));
    return { ok: true, text: `🔓 Unlocked <#${channel.id}>.` };
}

function parseLockDuration(text) {
    if (!text) return { expiresAt: null };
    const p = parseDuration(text);
    if (!p.success || !p.ms) return { error: 'Use a duration like 30m, 2h or 1d.' };
    if (p.ms > MAX_LOCK_MS) return { error: 'A lock can last at most 30 days.' };
    return { expiresAt: new Date(Date.now() + p.ms), label: formatDuration(text) };
}

const defer = i => i.deferReply({ flags: MessageFlags.Ephemeral });

const lockCmd = {
    name: 'lock', description: 'Stop members from sending messages in a channel',
    slashCommand: new SlashCommandBuilder().setName('lock').setDescription('Stop members from sending messages in a channel')
        .addChannelOption(o => o.setName('channel').setDescription('Channel to lock (default: this one)').addChannelTypes(...TEXT).setRequired(false))
        .addStringOption(o => o.setName('reason').setDescription('Why (shown in the channel)').setMaxLength(300).setRequired(false))
        .addStringOption(o => o.setName('duration').setDescription('Unlock automatically after, e.g. 30m, 2h, 1d').setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    async run(guild, channel, by, reason, duration) {
        const d = parseLockDuration(duration); if (d.error) return { text: `❌ ${d.error}` };
        const r = await doLock(channel, by, reason, d.expiresAt); return { text: r.ok ? r.text : `❌ ${r.text}` };
    },
    async executeSlash(i) { await defer(i); const r = await this.run(i.guild, i.options.getChannel('channel') ?? i.channel, i.user, i.options.getString('reason'), i.options.getString('duration')); return i.editReply(r.text); },
    async executePrefix(m, args) {
        const chId = /^<#(\d+)>$/.exec(args[0] ?? '')?.[1]; const channel = chId ? m.guild.channels.cache.get(chId) : m.channel;
        const rest = chId ? args.slice(1) : args; const r = await this.run(m.guild, channel, m.author, rest.join(' '), null); return m.reply(r.text);
    }
};

const unlockCmd = {
    name: 'unlock', description: 'Let members send messages in a locked channel again',
    slashCommand: new SlashCommandBuilder().setName('unlock').setDescription('Let members send messages in a locked channel again')
        .addChannelOption(o => o.setName('channel').setDescription('Channel to unlock (default: this one)').addChannelTypes(...TEXT).setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    async run(guild, channel, by) { const r = await doUnlock(channel, by); return { text: r.ok ? r.text : `❌ ${r.text}` }; },
    async executeSlash(i) { await defer(i); const r = await this.run(i.guild, i.options.getChannel('channel') ?? i.channel, i.user); return i.editReply(r.text); },
    async executePrefix(m, args) { const chId = /^<#(\d+)>$/.exec(args[0] ?? '')?.[1]; const r = await this.run(m.guild, chId ? m.guild.channels.cache.get(chId) : m.channel, m.author); return m.reply(r.text); }
};

const lockdownCmd = {
    name: 'lockdown', description: 'Lock every public text channel (for raids)',
    slashCommand: new SlashCommandBuilder().setName('lockdown').setDescription('Lock every public text channel (for raids)')
        .addBooleanOption(o => o.setName('confirm').setDescription('Set to true: this locks every channel members can currently talk in').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Why').setMaxLength(300).setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    async executeSlash(i) {
        if (!i.options.getBoolean('confirm')) return i.reply({ content: '❌ Lockdown not started. Set **confirm** to true.', flags: MessageFlags.Ephemeral });
        await defer(i);
        const { isLogChannelId } = require('../../logging/config');
        const guild = i.guild, reason = i.options.getString('reason') ?? 'Server lockdown';
        const targets = [...guild.channels.cache.values()].filter(c => isText(c) && !isLogChannelId(guild, c.id)
            && c.permissionsFor(guild.roles.everyone)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])).slice(0, MAX_LOCKDOWN);
        let ok = 0, skipped = 0; const problems = [];
        for (const c of targets) { const r = await doLock(c, i.user, reason, null, true); if (r.ok) ok++; else { skipped++; if (problems.length < 3) problems.push(r.text); } }
        await modLog(guild, new EmbedBuilder().setColor('#ff3b30').setTitle('🔒 Server lockdown').addFields(
            { name: 'By', value: `${i.user.tag} (${i.user.id})`, inline: true }, { name: 'Channels locked', value: `${ok}`, inline: true }, { name: 'Reason', value: reason }));
        return i.editReply(`🔒 Locked **${ok}** channel${ok === 1 ? '' : 's'}.${skipped ? `\n${skipped} skipped: ${problems.join(' ')}` : ''}\nUse \`/unlockdown\` to undo.`);
    }
};

const unlockdownCmd = {
    name: 'unlockdown', description: 'Undo /lockdown',
    slashCommand: new SlashCommandBuilder().setName('unlockdown').setDescription('Undo /lockdown and unlock every channel it locked')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    async executeSlash(i) {
        await defer(i);
        const guild = i.guild; let ok = 0, failed = 0;
        for (const l of (await lockService.list(guild.id)).filter(x => x.lockdown)) {
            const ch = guild.channels.cache.get(l.channelId);
            if (!ch) { await lockService.forget(guild.id, l.channelId); continue; }
            const r = await doUnlock(ch, i.user, { announce: false, log: false }); r.ok ? ok++ : failed++;
        }
        await modLog(guild, new EmbedBuilder().setColor('#43b581').setTitle('🔓 Lockdown ended').addFields({ name: 'By', value: `${i.user.tag} (${i.user.id})`, inline: true }, { name: 'Channels unlocked', value: `${ok}`, inline: true }));
        return i.editReply(`🔓 Unlocked **${ok}** channel${ok === 1 ? '' : 's'}.${failed ? ` ${failed} couldn’t be unlocked.` : ''}`);
    }
};

module.exports = { lockCmd, unlockCmd, lockdownCmd, unlockdownCmd, doUnlock };

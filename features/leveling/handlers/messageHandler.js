// features/leveling/handlers/messageHandler.js
// MessageCreate -> XP. Edits (MessageUpdate) are never listened to, so they cannot earn XP.
const { MessageType, ChannelType, PermissionFlagsBits } = require('discord.js');
const configService = require('../services/configService');
const xpService = require('../services/xpService');
const rewardService = require('../services/rewardService');
const antiSpam = require('../utils/antiSpam');
const { renderTemplate } = require('../utils/format');
const { titleForLevel } = require('../config/ladder');

const XP_CHANNEL_TYPES = new Set([
    ChannelType.GuildText, ChannelType.GuildAnnouncement,
    ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread,
    ChannelType.GuildVoice, ChannelType.GuildStageVoice          // voice-channel text chat
]);

const PREFIX = '!';   // same prefix as the moderation commands

function isIgnoredChannel(channel, config) {
    if (config.ignoredChannels.includes(channel.id)) return true;
    // A thread inherits its parent channel's exclusion.
    return !!channel.parentId && config.ignoredChannels.includes(channel.parentId);
}

async function handle(message) {
    // ── cheap, synchronous filters ───────────────────────────────────────────
    if (!message.guild || !message.author || message.author.bot || message.webhookId || message.system) return;
    if (message.type !== MessageType.Default && message.type !== MessageType.Reply) return;
    if (!message.channel || !XP_CHANNEL_TYPES.has(message.channel.type)) return;
    const content = message.content;
    if (!content || !content.trim()) return;                       // empty / attachment-only
    if (content.startsWith(PREFIX)) return;                        // bot commands are not chat
    if (antiSpam.checkContent(content)) return;

    const guildId = message.guild.id;
    const userId = message.author.id;

    let config;
    try { config = await configService.get(guildId); }
    catch (err) { console.error('❌ [leveling] config load failed:', err.message); return; }

    if (!config.enabled) return;
    if (isIgnoredChannel(message.channel, config)) return;
    const member = message.member;
    if (member && config.ignoredRoles.some(id => member.roles.cache.has(id))) return;

    // duplicates are recorded even while on cooldown so "spam, wait, spam again" is caught
    if (antiSpam.isDuplicate(guildId, userId, content)) return;
    if (antiSpam.onCooldown(guildId, userId, config.cooldownSec * 1000)) return;
    antiSpam.markAttempt(guildId, userId);

    // ── award ────────────────────────────────────────────────────────────────
    const amount = config.xpMin + Math.floor(Math.random() * (config.xpMax - config.xpMin + 1));
    const displayName = (member?.displayName || message.author.username).slice(0, 64);

    let result;
    try {
        result = await xpService.awardMessageXp(guildId, userId, displayName, amount, config.cooldownSec, config.progression);
    } catch (err) {
        console.error('❌ [leveling] XP award failed:', err.message);
        return;
    }
    if (!result.awarded || !result.leveledUp) return;

    await onLevelUp(message, member, result, config).catch(err => console.error('❌ [leveling] level-up handling failed:', err.message));
}

async function onLevelUp(message, member, result, config) {
    let guildMember = member;
    if (!guildMember) guildMember = await message.guild.members.fetch(message.author.id).catch(() => null);

    const rewards = guildMember
        ? await rewardService.syncMemberRewards(guildMember, result.newLevel, config)
        : { granted: [], removed: [], problems: [] };
    if (rewards.problems.length) console.warn(`⚠️ [leveling] reward problems in ${message.guild.id}: ${rewards.problems.join('; ')}`);

    if (!config.announce.enabled) return;
    await announce({ guild: message.guild, fallbackChannel: message.channel, user: message.author, xp: result.doc.xp, level: result.newLevel, granted: rewards.granted, config });
}

// Posts the level-up message (and reward notice). Channel order: configured channel,
// then the channel the member was talking in. Anything that fails is swallowed.
async function announce({ guild, fallbackChannel, user, xp, level, granted, config }) {
    const me = guild.members.me;
    const canSend = ch => ch?.isTextBased?.() && ch.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]);

    let channel = null;
    if (config.announce.channelId) {
        const configured = guild.channels.cache.get(config.announce.channelId);
        if (canSend(configured)) channel = configured;
    }
    if (!channel && canSend(fallbackChannel)) channel = fallbackChannel;
    if (!channel) return;

    let text = renderTemplate(config.announce.message, {
        user: `<@${user.id}>`, username: user.username, level, xp, server: guild.name, title: titleForLevel(level)
    });
    if (granted.length) text += `\n🏅 You unlocked ${granted.map(r => `**${r.name.replace(/[*_`~|>]/g, '')}**`).join(', ')}!`;

    try {
        // only the member may be pinged — admin-written text can never mention @everyone or roles
        await channel.send({ content: text.slice(0, 2000), allowedMentions: { parse: [], users: [user.id] } });
    } catch (err) {
        console.warn(`⚠️ [leveling] could not announce in ${channel.id}: ${err.code || err.message}`);
    }
}

module.exports = { handle, announce, isIgnoredChannel };

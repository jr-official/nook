// features/leveling/handlers/commandHandler.js
// /rank, /level progress, /level rewards, /leaderboard (+ its buttons).
const {
    EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, MessageFlags, escapeMarkdown
} = require('discord.js');
const cfg = require('../config/levelingConfig');
const configService = require('../services/configService');
const xpService = require('../services/xpService');
const rewardService = require('../services/rewardService');
const { progress, levelFromXp } = require('../utils/levelMath');
const { fmt, nextReset } = require('../utils/format');
const { renderRankCard } = require('../ui/rankCard');

const AMBER = 0xffd28a;
const EPHEMERAL = MessageFlags.Ephemeral;
const PERIOD_LABEL = { alltime: 'All-time', weekly: 'Weekly', monthly: 'Monthly' };

function bar(ratio, len = 14) {
    const filled = Math.round(Math.min(1, Math.max(0, ratio)) * len);
    return '█'.repeat(filled) + '░'.repeat(len - filled);
}

async function guildOnlyAndEnabled(interaction) {
    if (!interaction.inGuild() || !interaction.guild) {
        await interaction.reply({ content: '❌ This command only works in a server.', flags: EPHEMERAL });
        return null;
    }
    const config = await configService.get(interaction.guildId);
    if (!config.enabled) {
        await interaction.reply({ content: '💤 Leveling is turned off in this server.', flags: EPHEMERAL });
        return null;
    }
    return config;
}

// Everything the card / progress embed needs about one member.
async function loadStanding(guildId, userId, config) {
    const doc = await xpService.getMember(guildId, userId);
    const xp = doc?.xp ?? 0;
    const p = progress(xp, config.progression);
    const rank = doc && xp > 0 ? await xpService.getRank(guildId, userId, xp) : (await xpService.countMembers(guildId)) + 1;
    const total = await xpService.countMembers(guildId);
    return { doc, xp, p, rank, ranked: !!doc && xp > 0, total };
}

async function resolveTarget(interaction) {
    const user = interaction.options.getUser('member') || interaction.user;
    if (user.bot) {
        await interaction.editReply({ content: '🤖 Bots don\'t earn XP.' });
        return null;
    }
    const member = interaction.options.getMember('member') || (user.id === interaction.user.id ? interaction.member : null);
    return { user, member };
}

async function handleRank(interaction) {
    const config = await guildOnlyAndEnabled(interaction);
    if (!config) return;
    await interaction.deferReply();
    const target = await resolveTarget(interaction);
    if (!target) return;
    const { user, member } = target;
    const s = await loadStanding(interaction.guildId, user.id, config);
    const name = member?.displayName || user.globalName || user.username;

    try {
        const png = await renderRankCard({
            name, avatarUrl: (member ?? user).displayAvatarURL({ extension: 'png', size: 256, forceStatic: true }),
            level: s.p.level, xp: s.xp, into: s.p.into, needed: s.p.needed, ratio: s.p.ratio, atMax: s.p.atMax,
            rank: s.rank, total: Math.max(s.total, s.rank)
        });
        await interaction.editReply({ files: [new AttachmentBuilder(png, { name: `rank-${user.id}.png` })] });
    } catch (err) {
        console.error('❌ [leveling] rank card failed, falling back to embed:', err.message);
        await interaction.editReply({ embeds: [progressEmbed(user, name, s, config)] });
    }
}

function progressEmbed(user, name, s, config) {
    const e = new EmbedBuilder().setColor(AMBER).setAuthor({ name, iconURL: user.displayAvatarURL({ size: 64 }) })
        .setTitle(`Level ${s.p.level}`)
        .addFields(
            { name: 'Progress', value: s.p.atMax ? 'Max level reached 🏆' : `${bar(s.p.ratio)} **${Math.floor(s.p.ratio * 100)}%**\n${fmt(s.p.into)} / ${fmt(s.p.needed)} XP · ${fmt(s.p.remaining)} to go` },
            { name: 'Total XP', value: fmt(s.xp), inline: true },
            { name: 'Server rank', value: `#${fmt(s.rank)}`, inline: true },
            { name: 'Messages counted', value: fmt(s.doc?.messages ?? 0), inline: true }
        );
    const next = config.rewards.filter(r => r.level > s.p.level).sort((a, b) => a.level - b.level)[0];
    if (next) e.addFields({ name: 'Next reward', value: `<@&${next.roleId}> at level ${next.level}` });
    return e;
}

async function handleLevelProgress(interaction) {
    const config = await guildOnlyAndEnabled(interaction);
    if (!config) return;
    await interaction.deferReply({ flags: EPHEMERAL });
    const target = await resolveTarget(interaction);
    if (!target) return;
    const { user, member } = target;
    const s = await loadStanding(interaction.guildId, user.id, config);
    const [weekly, monthly] = await Promise.all([
        xpService.getPeriodXp(interaction.guildId, user.id, 'weekly'),
        xpService.getPeriodXp(interaction.guildId, user.id, 'monthly')
    ]);
    const embed = progressEmbed(user, member?.displayName || user.globalName || user.username, s, config)
        .addFields({ name: 'This week / month', value: `${fmt(weekly)} XP / ${fmt(monthly)} XP`, inline: false });
    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
}

async function handleLevelRewards(interaction) {
    const config = await guildOnlyAndEnabled(interaction);
    if (!config) return;
    await interaction.deferReply({ flags: EPHEMERAL });
    const doc = await xpService.getMember(interaction.guildId, interaction.user.id);
    const myLevel = levelFromXp(doc?.xp ?? 0, config.progression);
    const rewards = [...config.rewards].sort((a, b) => a.level - b.level || a.roleId.localeCompare(b.roleId));

    const e = new EmbedBuilder().setColor(AMBER).setTitle('🏅 Level rewards');
    if (!rewards.length) {
        e.setDescription('No level rewards are set up in this server yet.\nAdmins can add them with `/level-config` → **Rewards**.');
    } else {
        e.setDescription(rewards.map(r => `${myLevel >= r.level ? '✅' : '🔒'} **Level ${r.level}** — <@&${r.roleId}>`).join('\n'))
            .setFooter({ text: config.rewardMode === 'replace' ? 'Each new reward replaces the previous one.' : 'Rewards stack — you keep every role you unlock.' });
        e.addFields({ name: 'Your level', value: String(myLevel), inline: true });
    }
    await interaction.editReply({ embeds: [e], allowedMentions: { parse: [] } });
}

// ── Leaderboard ──────────────────────────────────────────────────────────────
async function renderLeaderboard(guild, config, period, page, ownerId) {
    const size = cfg.LEADERBOARD_PAGE_SIZE;
    let { total, rows } = await xpService.getLeaderboardPage(guild.id, period, page, size);
    const pages = Math.max(1, Math.ceil(total / size));
    if (page >= pages) {                                   // list shrank while the menu was open
        page = pages - 1;
        ({ total, rows } = await xpService.getLeaderboardPage(guild.id, period, page, size));
    }

    const medals = ['🥇', '🥈', '🥉'];
    const lines = rows.map((r, i) => {
        const pos = page * size + i + 1;
        const lvl = levelFromXp(r.xp, config.progression);
        const who = r.username ? `**${escapeMarkdown(r.username)}**` : `<@${r.userId}>`;
        const suffix = period === 'alltime' ? `Level ${lvl} · ${fmt(r.xp)} XP` : `${fmt(r.xp)} XP`;
        return `${medals[pos - 1] ?? `\`#${pos}\``} ${who} — ${suffix}`;
    });

    const e = new EmbedBuilder().setColor(AMBER)
        .setTitle(`🏆 ${PERIOD_LABEL[period]} leaderboard — ${guild.name}`.slice(0, 256))
        .setDescription(lines.length ? lines.join('\n') : 'Nobody has earned XP here yet. Start chatting!')
        .setFooter({ text: `Page ${page + 1}/${pages} · ${fmt(total)} member${total === 1 ? '' : 's'}` });
    if (period !== 'alltime') e.addFields({ name: 'Resets', value: `<t:${nextReset(period)}:R>` });

    const rowNav = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`lvl:lb:${period}:${page - 1}:${ownerId}`).setLabel('Previous').setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
        new ButtonBuilder().setCustomId(`lvl:lb:${period}:${page + 1}:${ownerId}`).setLabel('Next').setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1)
    );
    const rowPeriod = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`lvl:lbs:${ownerId}`).setPlaceholder('Leaderboard type')
            .addOptions(Object.entries(PERIOD_LABEL).map(([value, label]) => ({ label, value, default: value === period })))
    );
    return { embeds: [e], components: [rowNav, rowPeriod], allowedMentions: { parse: [] } };
}

async function handleLeaderboard(interaction) {
    const config = await guildOnlyAndEnabled(interaction);
    if (!config) return;
    await interaction.deferReply();
    const period = interaction.options.getString('period') || 'alltime';
    await interaction.editReply(await renderLeaderboard(interaction.guild, config, period, 0, interaction.user.id));
}

async function handleLeaderboardComponent(interaction) {
    const parts = interaction.customId.split(':');            // lvl:lb:<period>:<page>:<owner>  |  lvl:lbs:<owner>
    const ownerId = parts[parts.length - 1];
    if (interaction.user.id !== ownerId) {
        return interaction.reply({ content: 'Run `/leaderboard` yourself to browse it.', flags: EPHEMERAL });
    }
    if (!interaction.guild) return;
    const config = await configService.get(interaction.guildId);
    let period, page;
    if (interaction.isStringSelectMenu()) { period = interaction.values[0]; page = 0; }
    else { period = parts[2]; page = parseInt(parts[3], 10); }
    if (!PERIOD_LABEL[period]) period = 'alltime';
    if (!Number.isInteger(page) || page < 0) page = 0;
    await interaction.update(await renderLeaderboard(interaction.guild, config, period, page, ownerId));
}

module.exports = {
    handleRank, handleLevelProgress, handleLevelRewards, handleLeaderboard, handleLeaderboardComponent,
    renderLeaderboard, progressEmbed
};

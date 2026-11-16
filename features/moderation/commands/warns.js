// features/moderation/commands/warns.js
const {
    SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle
} = require('discord.js');
const { MessageFlags } = require('discord-api-types/v10');
const warningService = require('../services/warningService');
const { formatProofDisplay } = require('../utils/moderationUtils');

const WARNINGS_PER_PAGE = 5;
const DETAILS_PER_PAGE  = 3;

module.exports = {
    name: 'warns',
    description: 'View warnings for a user or the server leaderboard',
    permission: 'MODERATE_MEMBERS',

    slashCommand: new SlashCommandBuilder()
        .setName('warns')
        .setDescription('View warnings for a user or the server leaderboard')
        .addSubcommand(sub =>
            sub.setName('view')
                .setDescription('View warnings — leave user blank for server leaderboard')
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('The user to view warnings for (omit to see leaderboard)')
                        .setRequired(false))
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async executeSlash(interaction) {
        const targetUser = interaction.options.getUser('user') || null;
        await interaction.deferReply();
        if (targetUser) {
            await this.showUserWarnings(interaction, targetUser, 0);
        } else {
            await this.showLeaderboard(interaction, 0);
        }
    },

    async executePrefix(message, args) {
        if (!args.length || args[0].toLowerCase() !== 'view') {
            return message.reply('❌ **Usage:** `!warns view [@user]`');
        }

        let targetUser = null;
        if (args[1]) {
            const idOrMention = args[1];
            let id = null;
            if (/^\d{17,19}$/.test(idOrMention)) id = idOrMention;
            else if (idOrMention.match(/^<@!?(\d+)>$/)) id = idOrMention.match(/^<@!?(\d+)>$/)[1];

            if (id) {
                try { targetUser = await message.client.users.fetch(id); }
                catch { return message.reply('❌ Could not find that user.'); }
            }
        }

        if (args[1] && !targetUser) {
            return message.reply('❌ Could not resolve that user. Please use a mention or a valid user ID.');
        }

        if (targetUser) {
            const warnings   = await warningService.getUserWarnings(message.guild.id, targetUser.id);
            const totalPages = Math.max(1, Math.ceil(warnings.length / DETAILS_PER_PAGE));
            const embed      = buildUserWarningsEmbed(targetUser, warnings, 0);
            const components = buildPageButtons(`warns_user_${targetUser.id}`, 0, totalPages);
            // FIX: prefix command now sends paginated embeds with buttons, matching
            // the slash command behaviour. Previously it sent a single page with no
            // way to view warnings beyond the first 3.
            return message.reply({ embeds: [embed], components });
        } else {
            const leaderboard = await warningService.getGuildLeaderboard(message.guild.id);
            const totalPages  = Math.max(1, Math.ceil(leaderboard.length / WARNINGS_PER_PAGE));
            const embed       = buildLeaderboardEmbed(message.guild.name, leaderboard, 0);
            const components  = buildPageButtons('warns_lb', 0, totalPages);
            return message.reply({ embeds: [embed], components });
        }
    },

    async showLeaderboard(interaction, page) {
        const leaderboard = await warningService.getGuildLeaderboard(interaction.guild.id);
        const embed       = buildLeaderboardEmbed(interaction.guild.name, leaderboard, page);
        const totalPages  = Math.max(1, Math.ceil(leaderboard.length / WARNINGS_PER_PAGE));
        const components  = buildPageButtons('warns_lb', page, totalPages);
        await interaction.editReply({ embeds: [embed], components });
    },

    async showUserWarnings(interaction, targetUser, page) {
        const warnings   = await warningService.getUserWarnings(interaction.guild.id, targetUser.id);
        const embed      = buildUserWarningsEmbed(targetUser, warnings, page);
        const totalPages = Math.max(1, Math.ceil(warnings.length / DETAILS_PER_PAGE));
        const components = buildPageButtons(`warns_user_${targetUser.id}`, page, totalPages);
        await interaction.editReply({ embeds: [embed], components });
    }
};

async function handleWarnsButton(interaction) {
    const customId = interaction.customId;
    let match;

    match = customId.match(/^warns_lb_(prev|next)_(\d+)$/);
    if (match) {
        const page = parseInt(match[2]);
        await interaction.deferUpdate();
        const leaderboard = await warningService.getGuildLeaderboard(interaction.guild.id);
        const totalPages  = Math.max(1, Math.ceil(leaderboard.length / WARNINGS_PER_PAGE));
        const clampedPage = Math.min(Math.max(page, 0), totalPages - 1);
        const embed       = buildLeaderboardEmbed(interaction.guild.name, leaderboard, clampedPage);
        return interaction.editReply({ embeds: [embed], components: buildPageButtons('warns_lb', clampedPage, totalPages) });
    }

    match = customId.match(/^warns_user_(\d+)_(prev|next)_(\d+)$/);
    if (match) {
        const userId = match[1];
        const page   = parseInt(match[3]);
        await interaction.deferUpdate();
        let targetUser;
        try { targetUser = await interaction.client.users.fetch(userId); }
        catch { return interaction.editReply({ content: '❌ Could not fetch user.', embeds: [], components: [] }); }
        const warnings    = await warningService.getUserWarnings(interaction.guild.id, userId);
        const totalPages  = Math.max(1, Math.ceil(warnings.length / DETAILS_PER_PAGE));
        const clampedPage = Math.min(Math.max(page, 0), totalPages - 1);
        const embed       = buildUserWarningsEmbed(targetUser, warnings, clampedPage);
        return interaction.editReply({ embeds: [embed], components: buildPageButtons(`warns_user_${userId}`, clampedPage, totalPages) });
    }

    return false;
}

function buildLeaderboardEmbed(guildName, leaderboard, page) {
    const totalPages = Math.max(1, Math.ceil(leaderboard.length / WARNINGS_PER_PAGE));
    const start      = page * WARNINGS_PER_PAGE;
    const slice      = leaderboard.slice(start, start + WARNINGS_PER_PAGE);

    const embed = new EmbedBuilder()
        .setColor('#ffcc00')
        .setTitle(`⚠️ Warning Leaderboard — ${guildName}`)
        .setTimestamp()
        .setFooter({ text: `Page ${page + 1} of ${totalPages} • ${leaderboard.length} user${leaderboard.length !== 1 ? 's' : ''} with warnings` });

    if (!leaderboard.length) {
        embed.setDescription('✅ No warnings have been issued in this server.');
        return embed;
    }

    embed.setDescription(slice.map((entry, i) => {
        const rank  = start + i + 1;
        const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `**${rank}.**`;
        return `${medal} <@${entry.userId}> (${entry.userId}) — **${entry.points}** pt${entry.points === 1 ? '' : 's'} · ${entry.count} ${entry.count === 1 ? 'warning' : 'warnings'}`;
    }).join('\n'));

    return embed;
}

function buildUserWarningsEmbed(targetUser, warnings, page) {
    const totalPages = Math.max(1, Math.ceil(warnings.length / DETAILS_PER_PAGE));
    const start      = page * DETAILS_PER_PAGE;
    const slice      = warnings.slice(start, start + DETAILS_PER_PAGE);

    const embed = new EmbedBuilder()
        .setColor('#ffcc00')
        .setTitle(`⚠️ Warnings — ${targetUser.tag}`)
        .setThumbnail(targetUser.displayAvatarURL?.({ size: 128 }) ?? null)
        .setTimestamp()
        .setFooter({ text: `Page ${page + 1} of ${totalPages} • ${warnings.length} active warning${warnings.length !== 1 ? 's' : ''}` });

    if (!warnings.length) {
        embed.setDescription(`✅ **${targetUser.tag}** has no active warnings.`);
        return embed;
    }

    embed.setDescription(`**${targetUser.tag}** (${targetUser.id}) has **${warnings.length}** active warning${warnings.length !== 1 ? 's' : ''} worth **${warnings.reduce((a, w) => a + warningService.pointsOf(w), 0)}** point${warnings.reduce((a, w) => a + warningService.pointsOf(w), 0) === 1 ? '' : 's'}.`);

    for (const [i, w] of slice.entries()) {
        const ts    = Math.floor(new Date(w.createdAt).getTime() / 1000);
        const lines = [
            `**Reason:** ${w.reason}`,
            `**Severity:** ${warningService.clampSeverity(w.severity)}`,
            `**Moderator:** <@${w.moderatorId}> (${w.moderatorId})`,
            `**Issued:** <t:${ts}:F> (<t:${ts}:R>)`,
            `**DM sent:** ${w.dmSent ? '✅ Yes' : '❌ No'}`
        ];
        if (w.proof) lines.push(`**Proof:** ${formatProofDisplay(w.proof)}`);
        embed.addFields({ name: `Warning #${start + i + 1}`, value: lines.join('\n'), inline: false });
    }

    return embed;
}

function buildPageButtons(prefix, currentPage, totalPages) {
    if (totalPages <= 1) return [];
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${prefix}_prev_${currentPage - 1}`)
            .setLabel('← Previous').setStyle(ButtonStyle.Secondary).setDisabled(currentPage === 0),
        new ButtonBuilder()
            .setCustomId(`${prefix}_next_${currentPage + 1}`)
            .setLabel('Next →').setStyle(ButtonStyle.Secondary).setDisabled(currentPage >= totalPages - 1)
    )];
}

module.exports.handleWarnsButton = handleWarnsButton;
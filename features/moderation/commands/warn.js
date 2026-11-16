// features/moderation/commands/warn.js
const {
    SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle
} = require('discord.js');
const { MessageFlags } = require('discord-api-types/v10');
const {
    canModerate, sendDM, logModeration,
    parseMembers, handleProofData, formatProofDisplay
} = require('../utils/moderationUtils');
const { generateCaseId } = require('../utils/caseID');
const { WARN_POINT_THRESHOLD } = require('../config/moderationConfig');
const warningService = require('../services/warningService');

const REMOVE_PAGE_SIZE = 3;

module.exports = {
    name: 'warn',
    description: 'Warn a member or remove a warning',
    permission: 'MODERATE_MEMBERS',

    slashCommand: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Warn a member or manage warnings')
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Issue a warning to one or multiple members')
                .addStringOption(opt  => opt.setName('user').setDescription('User(s) to warn').setRequired(true))
                .addStringOption(opt  => opt.setName('reason').setDescription('Reason for the warning').setRequired(true))
                .addIntegerOption(opt => opt.setName('severity').setDescription('Weight 0-3 (default 0). Points add up; staff are alerted at the threshold').setMinValue(0).setMaxValue(3).setRequired(false))
                .addBooleanOption(opt => opt.setName('dm').setDescription('Send DM to user (default: true)').setRequired(false))
                .addStringOption(opt  => opt.setName('proof_url').setDescription('Evidence/proof URL').setRequired(false))
                .addAttachmentOption(opt => opt.setName('proof_file').setDescription('Upload proof file').setRequired(false))
        )
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Pick and remove a specific warning from a member')
                .addUserOption(opt => opt.setName('user').setDescription('The user to remove a warning from').setRequired(true))
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async executeSlash(interaction) {
        const sub = interaction.options.getSubcommand();
        if (sub === 'add') {
            await this.executeWarnAdd(interaction, {
                users:      interaction.options.getString('user'),
                severity:   interaction.options.getInteger('severity') ?? 0,
                reason:     interaction.options.getString('reason'),
                dm:         interaction.options.getBoolean('dm') !== false,
                proof_url:  interaction.options.getString('proof_url'),
                proof_file: interaction.options.getAttachment('proof_file')
            });
        } else if (sub === 'remove') {
            await this.executeWarnRemovePicker(interaction, interaction.options.getUser('user'), 0);
        }
    },

    async executePrefix(message, args) {
        if (!args.length) {
            return message.reply(
                '❌ **Usage:**\n' +
                '`!warn <user> <reason> [options]` — Issue a warning\n' +
                '`!warn remove <user>` — Open removal picker\n' +
                '**Options:** `--no-dm`, `--severity=0-3`, `--proof=<url>`'
            );
        }

        if (args[0].toLowerCase() === 'remove') {
            if (!args[1]) return message.reply('❌ You must provide a user.');
            let userId = args[1];
            if (userId.match(/^<@!?(\d+)>$/)) userId = userId.match(/^<@!?(\d+)>$/)[1];
            let targetUser;
            try { targetUser = await message.client.users.fetch(userId); }
            catch { return message.reply('❌ Could not find that user.'); }
            const warnings = await warningService.getUserWarnings(message.guild.id, targetUser.id);
            if (!warnings.length) return message.reply(`✅ **${targetUser.tag}** has no active warnings.`);
            const { embed, components } = buildRemovePickerPage(targetUser, warnings, 0);
            return message.reply({ embeds: [embed], components });
        }

        if (args.length < 2) return message.reply('❌ You must provide a user and a reason.');

        const options = { users: args[0], reason: '', dm: true, severity: 0, proof_url: null, proof_file: null };
        const reasonParts = [];
        for (let i = 1; i < args.length; i++) {
            if (args[i] === '--no-dm') options.dm = false;
            else if (args[i].startsWith('--proof=')) options.proof_url = args[i].split('=')[1];
            else if (/^--sev(erity)?=/.test(args[i])) {
                const n = Number(args[i].split('=')[1]);
                if (!Number.isInteger(n) || n < 0 || n > 3) return message.reply('❌ Severity must be a whole number from 0 to 3.');
                options.severity = n;
            }
            else reasonParts.push(args[i]);
        }
        options.reason = reasonParts.join(' ');
        if (!options.reason) return message.reply('❌ Reason is required.');
        await this.executeWarnAdd(message, options);
    },

    async executeWarnAdd(context, options) {
        const guild         = context.guild;
        const moderator     = context.member || context.author;
        const moderatorUser = moderator.user ?? moderator;
        const isInteraction = context.replied !== undefined;

        const proofData = await handleProofData(options.proof_url, options.proof_file);
        if (proofData.error) {
            const msg = `❌ Proof validation failed: ${proofData.error}`;
            return isInteraction
                ? context.reply({ content: msg, flags: MessageFlags.Ephemeral })
                : context.reply(msg);
        }

        const memberResult = await parseMembers(guild, options.users, false);
        if (!memberResult.success) {
            const msg = `❌ ${memberResult.message}`;
            return isInteraction
                ? context.reply({ content: msg, flags: MessageFlags.Ephemeral })
                : context.reply(msg);
        }

        if (isInteraction) await context.deferReply();

        const results = {
            successful: [],
            failed: (memberResult.failed || []).map(f => ({ user: f.user, reason: f.reason }))
        };

        for (const target of memberResult.targets) {
            try {
                if (!target.member) {
                    results.failed.push({ user: target.user, reason: 'User is not in the server.' });
                    continue;
                }

                const canMod = await canModerate(moderator, target.member);
                if (!canMod.success) {
                    results.failed.push({ user: target.user, reason: canMod.message });
                    continue;
                }

                const severity      = warningService.clampSeverity(options.severity);
                const pointsBefore  = await warningService.getUserPoints(guild.id, target.user.id);
                const warning       = await warningService.addWarning(guild.id, target.user, moderatorUser, options.reason, proofData.data, false, severity);
                const caseId        = warning.caseId;
                const totalWarnings = await warningService.getUserWarningCount(guild.id, target.user.id);
                const points        = pointsBefore + severity;
                const crossed       = WARN_POINT_THRESHOLD > 0 && pointsBefore < WARN_POINT_THRESHOLD && points >= WARN_POINT_THRESHOLD;

                let dmSent = false;
                if (options.dm) {
                    try {
                        await sendDM(target.user, {
                            type: 'warn', guild: guild.name, reason: options.reason,
                            moderatorTag: moderatorUser.tag, moderatorId: moderatorUser.id,
                            proof: proofData.data, caseId
                        });
                        dmSent = true;
                    } catch {
                        dmSent = false;
                    }
                }

                // FIX (Bug 1): markDmSent is now wrapped in its own try/catch.
                // Previously it was called as part of the DM try block, meaning a DB
                // failure here would be mistakenly caught by the DM catch and recorded
                // as dmSent=false even when the DM was actually delivered. Now the two
                // operations are independent: DM success/failure is tracked in dmSent,
                // and the DB sync failure is logged separately without corrupting that value.
                try {
                    await warningService.markDmSent(warning._id, dmSent);
                } catch (dbErr) {
                    console.error(`[warn] Failed to persist dmSent=${dmSent} for warning ${warning._id}:`, dbErr);
                }

                results.successful.push({ user: target.user, caseId, totalWarnings, dmSent, severity, points, crossed });

                await logModeration(guild, {
                    type: 'warn', caseId, target: target.user, moderator: moderatorUser,
                    reason: options.reason, proof: proofData.data, totalWarnings, dmSent,
                    severity, points, threshold: WARN_POINT_THRESHOLD, thresholdCrossed: crossed
                });
            } catch (error) {
                console.error(`Failed to warn ${target.user?.tag}:`, error);
                results.failed.push({ user: target.user, reason: error.message });
            }
        }

        const embed = new EmbedBuilder()
            .setColor('#ffcc00').setTitle('⚠️ Warn Results').setTimestamp()
            .setFooter({ text: `Moderator: ${moderatorUser.tag}`, iconURL: moderatorUser.displayAvatarURL() });

        if (results.successful.length > 0) {
            embed.addFields({
                name: `Warned (${results.successful.length})`,
                inline: false,
                value: results.successful.map(r =>
                    `✅ **${r.user.tag}** (${r.user.id})\n   └ Case ID: \`${r.caseId}\` | Total: **${r.totalWarnings}** | Points: **${r.points}** (+${r.severity})${r.crossed ? ' 🚨 threshold reached' : ''} | DM: ${r.dmSent ? '✅' : '❌'}`
                ).join('\n')
            });
        }
        if (results.failed.length > 0) {
            embed.addFields({
                name: `Failed (${results.failed.length})`,
                inline: false,
                value: results.failed.map(r =>
                    `❌ **${r.user?.tag || 'Unknown'}** — ${r.reason}`
                ).join('\n')
            });
        }

        const details = [`**Reason:** ${options.reason}`];
        if (proofData.data) details.push(`**Proof:** ${formatProofDisplay(proofData.data)}`);
        embed.addFields({ name: 'Details', value: details.join('\n'), inline: false });
        if (proofData.data?.type === 'file' && proofData.data.isImage) embed.setImage(proofData.data.url);

        return isInteraction
            ? context.editReply({ embeds: [embed] })
            : context.reply({ embeds: [embed] });
    },

    async executeWarnRemovePicker(interaction, targetUser, page) {
        await interaction.deferReply();
        const warnings = await warningService.getUserWarnings(interaction.guild.id, targetUser.id);
        if (!warnings.length) {
            return interaction.editReply({ embeds: [
                new EmbedBuilder()
                    .setColor('#00ff99')
                    .setDescription(`✅ **${targetUser.tag}** has no active warnings to remove.`)
            ]});
        }
        const { embed, components } = buildRemovePickerPage(targetUser, warnings, page);
        return interaction.editReply({ embeds: [embed], components });
    }
};

// ─── Button handler (exported separately) ────────────────────────────────────
async function handleWarnRemoveButton(interaction, guild) {
    const id = interaction.customId;

    // ── Pagination ────────────────────────────────────────────────────────────
    const pageMatch = id.match(/^warnrm_page_(\d+)_(\d+)$/);
    if (pageMatch) {
        const userId = pageMatch[1];
        const page   = parseInt(pageMatch[2]);
        await interaction.deferUpdate();

        let targetUser;
        try { targetUser = await interaction.client.users.fetch(userId); }
        catch { return interaction.editReply({ content: '❌ Could not fetch user.', embeds: [], components: [] }); }

        const warnings   = await warningService.getUserWarnings(guild.id, userId);
        if (!warnings.length) {
            return interaction.editReply({
                embeds: [new EmbedBuilder().setColor('#00ff99').setDescription(`✅ **${targetUser.tag}** has no more active warnings.`)],
                components: []
            });
        }
        const totalPages  = Math.ceil(warnings.length / REMOVE_PAGE_SIZE);
        const clampedPage = Math.min(Math.max(page, 0), totalPages - 1);
        const { embed, components } = buildRemovePickerPage(targetUser, warnings, clampedPage);
        return interaction.editReply({ embeds: [embed], components });
    }

    // ── Remove a specific warning ─────────────────────────────────────────────
    const removeMatch = id.match(/^warnrm_do_([a-f0-9]{24})_(\d+)$/);
    if (removeMatch) {
        const warningMongoId = removeMatch[1];
        const userId         = removeMatch[2];
        await interaction.deferUpdate();

        const removed = await warningService.removeWarningById(warningMongoId);
        if (!removed) {
            return interaction.editReply({
                content: '❌ That warning could not be found or was already removed.',
                embeds: [], components: []
            });
        }

        let targetUser;
        try { targetUser = await interaction.client.users.fetch(userId); }
        catch { targetUser = { tag: removed.username, id: userId, displayAvatarURL: () => null }; }

        const remaining     = await warningService.getUserWarningCount(guild.id, userId);
        const ts            = Math.floor(new Date(removed.createdAt).getTime() / 1000);
        const removedCaseId = removed.caseId || 'N/A';
        const removalCaseId = generateCaseId('warn_remove');

        let removalDmSent = false;
        if (targetUser && typeof targetUser.send === 'function') {
            try {
                await sendDM(targetUser, {
                    type:           'warn_remove',
                    guild:          guild.name,
                    reason:         'Removed via warning picker',
                    originalReason: removed.reason || 'No reason recorded',
                    moderatorTag:   interaction.user.tag,
                    moderatorId:    interaction.user.id,
                    caseId:         removalCaseId,
                    remaining,
                    proof:          null
                });
                removalDmSent = true;
            } catch (dmErr) {
                console.error(`Failed to DM warn_remove to ${targetUser.tag}:`, dmErr);
            }
        }

        const confirmEmbed = new EmbedBuilder()
            .setColor('#00ccff').setTitle('🗑️ Warning Removed')
            .setDescription(`A warning has been removed from **${targetUser.tag}** (${userId}).`)
            .addFields(
                { name: 'Removal Case ID',        value: removalCaseId,                                        inline: true  },
                { name: 'Removed Warning ID',     value: removedCaseId,                                        inline: true  },
                { name: 'Removed Warning Reason', value: removed.reason || 'No reason recorded',               inline: false },
                { name: 'Originally Issued By',   value: `<@${removed.moderatorId}> (${removed.moderatorId})`, inline: true  },
                { name: 'Originally Issued',      value: `<t:${ts}:F>`,                                        inline: true  },
                { name: 'DM was sent',            value: removed.dmSent ? '✅ Yes' : '❌ No',                  inline: true  },
                { name: 'Remaining Warnings',     value: `${remaining}`,                                       inline: true  }
            )
            .setTimestamp()
            .setFooter({
                text: `Removed by ${interaction.user.tag} • Case ${removalCaseId}`,
                iconURL: interaction.user.displayAvatarURL()
            });

        if (removed.proof) {
            confirmEmbed.addFields({ name: 'Original Proof', value: formatProofDisplay(removed.proof), inline: false });
        }

        await logModeration(guild, {
            type: 'warn_remove', caseId: removalCaseId, removedCaseId,
            target:         { tag: removed.username, id: userId },
            moderator:      interaction.user,
            reason:         'Removed via warning picker',
            originalReason: removed.reason || 'No reason recorded',
            remaining, proof: null, dmSent: removalDmSent
        });

        if (remaining === 0) {
            return interaction.editReply({ embeds: [confirmEmbed], components: [] });
        }

        const updatedWarnings = await warningService.getUserWarnings(guild.id, userId);
        const { embed: pickerEmbed, components } = buildRemovePickerPage(targetUser, updatedWarnings, 0);
        return interaction.editReply({ embeds: [confirmEmbed, pickerEmbed], components });
    }

    return false;
}

// ─── Picker page builder ──────────────────────────────────────────────────────
function buildRemovePickerPage(targetUser, warnings, page) {
    const totalPages = Math.max(1, Math.ceil(warnings.length / REMOVE_PAGE_SIZE));
    const start      = page * REMOVE_PAGE_SIZE;
    const slice      = warnings.slice(start, start + REMOVE_PAGE_SIZE);

    const embed = new EmbedBuilder()
        .setColor('#ffcc00')
        .setTitle(`⚠️ Remove Warning — ${targetUser.tag}`)
        .setThumbnail(targetUser.displayAvatarURL ? targetUser.displayAvatarURL({ size: 64 }) : null)
        .setDescription(
            `**${targetUser.tag}** (${targetUser.id}) has **${warnings.length}** active warning${warnings.length !== 1 ? 's' : ''}.\n` +
            `Click a **Remove** button below to remove that specific warning.\n\u200b`
        )
        .setFooter({ text: `Page ${page + 1} of ${totalPages} • ${warnings.length} active warning${warnings.length !== 1 ? 's' : ''}` });

    for (const [i, w] of slice.entries()) {
        const ts     = Math.floor(new Date(w.createdAt).getTime() / 1000);
        const caseId = w.caseId || 'N/A';
        const lines  = [
            `**Case ID:** \`${caseId}\``,
            `**Reason:** ${w.reason}`,
            `**Moderator:** <@${w.moderatorId}> (${w.moderatorId})`,
            `**Issued:** <t:${ts}:F> (<t:${ts}:R>)`,
            `**DM sent:** ${w.dmSent ? '✅ Yes' : '❌ No'}`
        ];
        if (w.proof) lines.push(`**Proof:** ${formatProofDisplay(w.proof)}`);
        embed.addFields({ name: `Warning #${start + i + 1}`, value: lines.join('\n'), inline: false });
    }

    const rows = [];

    rows.push(new ActionRowBuilder().addComponents(
        slice.map(w => {
            const label = w.caseId || w._id.toString().slice(-6).toUpperCase();
            return new ButtonBuilder()
                .setCustomId(`warnrm_do_${w._id.toString()}_${targetUser.id}`)
                .setLabel(`Remove ${label}`)
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🗑️');
        })
    ));

    if (totalPages > 1) {
        rows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`warnrm_page_${targetUser.id}_${page - 1}`)
                .setLabel('← Previous').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId(`warnrm_page_${targetUser.id}_${page + 1}`)
                .setLabel('Next →').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1)
        ));
    }

    return { embed, components: rows };
}

module.exports.handleWarnRemoveButton = handleWarnRemoveButton;
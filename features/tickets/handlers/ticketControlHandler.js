// features/tickets/handlers/ticketControlHandler.js
const { Buffer } = require('buffer');
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags } = require('discord.js');
const { cleanUsername } = require('../utils/cleanup');

async function handleButtonInteraction(interaction, helpers, services, CONFIG, timeout) {
    switch (interaction.customId) {
        case 'close_ticket':         return handleCloseTicket(interaction, helpers, services, CONFIG, timeout);
        case 'confirm_close_ticket': return handleConfirmClose(interaction, helpers, services, CONFIG, timeout);
        case 'cancel_close_ticket':  return handleCancelClose(interaction, helpers, services, CONFIG, timeout);
        case 'delete_ticket':        return handleDeleteTicket(interaction, helpers, services, CONFIG, timeout);
        case 'open_ticket':          return handleOpenTicket(interaction, helpers, services, CONFIG, timeout);
        case 'transcript_ticket':    return handleTranscript(interaction, helpers, services, CONFIG, timeout);
        default:
            clearTimeout(timeout);
            return false;
    }
}

// ─── Shared helper: find the ticket creator's user ID from channel overwrites ─
// Returns null if not found. Guards against members who have left the guild.
function findTicketCreatorId(interaction, staffRoleName) {
    const channelPerms = interaction.channel.permissionOverwrites.cache;
    for (const [id, overwrite] of channelPerms) {
        if (overwrite.type !== 1 || id === interaction.guild.id) continue;
        // Check cache first; member may have left — in that case treat the
        // overwrite ID as the creator (we still have their ID for permission edits).
        const member = interaction.guild.members.cache.get(id);
        if (!member || !member.roles.cache.some(r => r.name === staffRoleName)) {
            return id;
        }
    }
    return null;
}

// ─── Close ────────────────────────────────────────────────────────────────────
async function handleCloseTicket(interaction, helpers, services, CONFIG, timeout) {
    const { safeReply, safeDeferInteraction } = helpers;
    const { ticketService, cacheService }     = services;

    const success = await safeDeferInteraction(interaction, true);
    if (!success) { clearTimeout(timeout); return true; }

    const staffRole    = await cacheService.getStaffRole(interaction.guild, CONFIG.STAFF_ROLE_NAME);
    const isStaff      = staffRole && interaction.member.roles.cache.has(staffRole.id);
    const ticketUserId = findTicketCreatorId(interaction, CONFIG.STAFF_ROLE_NAME);
    const isTicketCreator = ticketUserId === interaction.user.id;

    if (!isStaff && !isTicketCreator) {
        clearTimeout(timeout);
        await safeReply(interaction, {
            content: '❌ You can only close your own tickets or you need to be a staff member.',
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    const confirmEmbed = new EmbedBuilder()
        .setTitle('🔒 Close Ticket')
        .setDescription('Are you sure you want to close this ticket?')
        .setColor(0xED4245);

    const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm_close_ticket').setLabel('Yes, Close').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('cancel_close_ticket').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    );

    const confirmationMessage = await interaction.channel.send({ embeds: [confirmEmbed], components: [confirmRow] });

    const existing = ticketService.ticketMetadata.get(interaction.channel.id) || {};
    ticketService.ticketMetadata.set(interaction.channel.id, {
        ...existing,
        closeInitiator:        interaction.user.id,
        ticketCreatorId:       ticketUserId,
        confirmationMessageId: confirmationMessage.id
    });

    clearTimeout(timeout);
    return true;
}

// ─── Confirm close ────────────────────────────────────────────────────────────
async function handleConfirmClose(interaction, helpers, services, CONFIG, timeout) {
    const { safeReply, safeDeferInteraction } = helpers;
    const { ticketService, cacheService }     = services;

    const success = await safeDeferInteraction(interaction, true);
    if (!success) { clearTimeout(timeout); return true; }

    const metadata  = ticketService.ticketMetadata.get(interaction.channel.id);
    const staffRole = await cacheService.getStaffRole(interaction.guild, CONFIG.STAFF_ROLE_NAME);
    const isStaff   = staffRole && interaction.member.roles.cache.has(staffRole.id);

    if (!isStaff && (!metadata || metadata.closeInitiator !== interaction.user.id)) {
        clearTimeout(timeout);
        await safeReply(interaction, {
            content: '❌ Only the user who initiated this action can confirm it.',
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    const timer = ticketService.ticketCleanupTimers.get(interaction.channel.id);
    if (timer) { clearTimeout(timer); ticketService.ticketCleanupTimers.delete(interaction.channel.id); }

    if (metadata?.ticketCreatorId) {
        await interaction.channel.permissionOverwrites.edit(metadata.ticketCreatorId, {
            ViewChannel: false, SendMessages: false, AddReactions: false
        }).catch(console.error);
    }

    const closedEmbed = new EmbedBuilder()
        .setTitle(`Ticket Closed by @${interaction.user.username}`)
        .setColor(0x2F3136)
        .setTimestamp();

    const controlsRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('transcript_ticket').setLabel('Transcript').setStyle(ButtonStyle.Secondary).setEmoji('📄'),
        new ButtonBuilder().setCustomId('open_ticket').setLabel('Open').setStyle(ButtonStyle.Secondary).setEmoji('🔓'),
        new ButtonBuilder().setCustomId('delete_ticket').setLabel('Delete').setStyle(ButtonStyle.Secondary).setEmoji('🗑️')
    );

    await interaction.channel.send({ content: 'Support team ticket controls', embeds: [closedEmbed], components: [controlsRow] });

    if (metadata?.confirmationMessageId) {
        const msg = await interaction.channel.messages.fetch(metadata.confirmationMessageId).catch(() => null);
        if (msg) await msg.delete().catch(console.error);
    }

    clearTimeout(timeout);
    return true;
}

// ─── Cancel close ─────────────────────────────────────────────────────────────
async function handleCancelClose(interaction, helpers, services, CONFIG, timeout) {
    const { safeReply, safeDeferInteraction } = helpers;
    const { ticketService, cacheService }     = services;

    const success = await safeDeferInteraction(interaction, true);
    if (!success) { clearTimeout(timeout); return true; }

    const metadata  = ticketService.ticketMetadata.get(interaction.channel.id);
    const staffRole = await cacheService.getStaffRole(interaction.guild, CONFIG.STAFF_ROLE_NAME);
    const isStaff   = staffRole && interaction.member.roles.cache.has(staffRole.id);

    if (!isStaff && (!metadata || metadata.closeInitiator !== interaction.user.id)) {
        clearTimeout(timeout);
        await safeReply(interaction, {
            content: '❌ Only the user who initiated this action can cancel it.',
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    if (metadata?.confirmationMessageId) {
        const msg = await interaction.channel.messages.fetch(metadata.confirmationMessageId).catch(() => null);
        if (msg) await msg.delete().catch(console.error);
    }

    await interaction.channel.send({ content: '✅ Ticket closure cancelled.' });
    clearTimeout(timeout);
    return true;
}

// ─── Delete ───────────────────────────────────────────────────────────────────
async function handleDeleteTicket(interaction, helpers, services, CONFIG, timeout) {
    const { safeReply, safeInteractionResponse } = helpers;
    const { ticketService, cacheService }        = services;

    const staffRole = await cacheService.getStaffRole(interaction.guild, CONFIG.STAFF_ROLE_NAME);
    const isStaff   = staffRole && interaction.member.roles.cache.has(staffRole.id);

    if (!isStaff) {
        clearTimeout(timeout);
        await safeReply(interaction, {
            content: '❌ Only staff members can delete tickets.',
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    const success = await safeInteractionResponse(interaction, async () => {
        await interaction.reply({ content: `🗑️ Deleting ticket in ${CONFIG.DELETION_DELAY_SECONDS} seconds...` });
    });
    if (!success) { clearTimeout(timeout); return true; }

    setTimeout(async () => {
        try {
            // findTicketCreatorId returns the ID even if the member has left,
            // so removeTicketFromTracking can still update the DB correctly.
            const ticketUserId = findTicketCreatorId(interaction, CONFIG.STAFF_ROLE_NAME);
            if (ticketUserId) {
                ticketService.removeTicketFromTracking(ticketUserId, interaction.channel.id);
            } else {
                // Creator couldn't be worked out: still close the record so it isn't "open" forever.
                ticketService.closeTicket(interaction.channel.id);
            }
            await interaction.channel.delete();
        } catch (error) {
            console.error('Error deleting ticket channel:', error);
        }
    }, CONFIG.DELETION_DELAY_SECONDS * 1000);

    clearTimeout(timeout);
    return true;
}

// ─── Reopen ───────────────────────────────────────────────────────────────────
async function handleOpenTicket(interaction, helpers, services, CONFIG, timeout) {
    const { safeReply, safeDeferInteraction } = helpers;
    const { cacheService }                    = services;

    const success = await safeDeferInteraction(interaction, true);
    if (!success) { clearTimeout(timeout); return true; }

    const staffRole = await cacheService.getStaffRole(interaction.guild, CONFIG.STAFF_ROLE_NAME);
    const isStaff   = staffRole && interaction.member.roles.cache.has(staffRole.id);

    if (!isStaff) {
        clearTimeout(timeout);
        await safeReply(interaction, {
            content: '❌ Only staff members can reopen tickets.',
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    // findTicketCreatorId returns the ID even if the member has left.
    // We still restore their permission overwrite so if they rejoin they
    // can see the ticket again; if they've left, the edit is a no-op.
    const ticketUserId = findTicketCreatorId(interaction, CONFIG.STAFF_ROLE_NAME);
    if (ticketUserId) {
        await interaction.channel.permissionOverwrites.edit(ticketUserId, {
            ViewChannel: true, SendMessages: true, AddReactions: true
        }).catch(console.error);
    }

    const reopenEmbed = new EmbedBuilder()
        .setTitle('🔓 Ticket Reopened')
        .setDescription(`This ticket has been reopened by ${interaction.user}`)
        .setColor(0x57F287)
        .setTimestamp();

    const closeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒')
    );

    await interaction.channel.send({ embeds: [reopenEmbed], components: [closeRow] });
    clearTimeout(timeout);
    return true;
}

// ─── Transcript ───────────────────────────────────────────────────────────────
async function handleTranscript(interaction, helpers, services, CONFIG, timeout) {
    const { safeReply, safeInteractionResponse }         = helpers;
    const { transcriptService, cacheService, ticketService } = services;

    const staffRole = await cacheService.getStaffRole(interaction.guild, CONFIG.STAFF_ROLE_NAME);
    const isStaff   = staffRole && interaction.member.roles.cache.has(staffRole.id);

    if (!isStaff) {
        clearTimeout(timeout);
        await safeReply(interaction, {
            content: '❌ Only staff members can generate transcripts.',
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    const success = await safeInteractionResponse(interaction, async () => {
        await interaction.reply({ content: '📄 Generating transcript... Please wait.', flags: MessageFlags.Ephemeral });
    });
    if (!success) { clearTimeout(timeout); return true; }

    try {
        let ticketCreator;
        const ticketUserId = findTicketCreatorId(interaction, CONFIG.STAFF_ROLE_NAME);

        if (ticketUserId) {
            try {
                const fetched = await interaction.guild.members.fetch(ticketUserId);
                ticketCreator = fetched.user;
            } catch {
                // Member left — still use their ID to show something useful
                ticketCreator = { username: 'Unknown', discriminator: '0000' };
            }
        }

        if (!ticketCreator) {
            const channelName         = interaction.channel.name;
            const usernameFromChannel = channelName.split('-').slice(1).join('-');
            const member = interaction.guild.members.cache.find(m =>
                cleanUsername(m.user.username, m.user.id) === usernameFromChannel
            );
            ticketCreator = member ? member.user : { username: 'Unknown', discriminator: '0000' };
        }

        const transcriptData = await transcriptService.generateTranscript(
            interaction.channel,
            ticketCreator,
            ticketService.ticketMetadata
        );

        if (!transcriptData) {
            clearTimeout(timeout);
            await safeReply(interaction, { content: '❌ Failed to generate transcript. Please try again.' });
            return true;
        }

        const logsChannel = interaction.guild.channels.cache.get(CONFIG.TICKET_LOGS_CHANNEL_ID);
        if (logsChannel) {
            const transcriptEmbed = new EmbedBuilder()
                .setTitle('📄 Ticket Transcript Saved')
                .setColor(0x7289da)
                .addFields(
                    { name: 'Ticket Owner',   value: `${ticketCreator.username}#${ticketCreator.discriminator || '0'}`, inline: true },
                    { name: 'Ticket Name',    value: interaction.channel.name,               inline: true },
                    { name: 'Panel Name',     value: transcriptData.ticketType,              inline: true },
                    { name: 'Total Messages', value: transcriptData.totalMessages.toString(), inline: true },
                    { name: 'Closed By',      value: interaction.user.toString(),            inline: true },
                    { name: 'Closed At',      value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                );

            await logsChannel.send({
                content: `Transcript for ${interaction.channel.name}`,
                embeds:  [transcriptEmbed],
                files:   [{
                    attachment: Buffer.from(transcriptData.html, 'utf8'),
                    name:       `transcript-${interaction.channel.name}.html`
                }]
            });
        }

        clearTimeout(timeout);
        await safeReply(interaction, { content: '✅ Transcript generated and sent to the logs channel.' });

    } catch (error) {
        console.error('Error generating transcript:', error);
        clearTimeout(timeout);
        await safeReply(interaction, { content: '❌ An error occurred while generating the transcript.' });
    }

    return true;
}

module.exports = { handleButtonInteraction };
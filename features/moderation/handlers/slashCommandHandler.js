// features/moderation/handlers/slashCommandHandler.js
const { PermissionFlagsBits } = require('discord.js');

const COMMAND_PERMISSIONS = {
    ban:    { flag: PermissionFlagsBits.BanMembers,      label: 'ban members' },
    unban:  { flag: PermissionFlagsBits.BanMembers,      label: 'ban members' },
    kick:   { flag: PermissionFlagsBits.KickMembers,     label: 'kick members' },
    mute:   { flag: PermissionFlagsBits.ModerateMembers, label: 'moderate members (timeout)' },
    unmute: { flag: PermissionFlagsBits.ModerateMembers, label: 'moderate members (timeout)' },
    warn:   { flag: PermissionFlagsBits.ModerateMembers, label: 'moderate members' },
    warns:  { flag: PermissionFlagsBits.ModerateMembers, label: 'moderate members' },
    case:   { flag: PermissionFlagsBits.ModerateMembers, label: 'moderate members' },
    purge:      { flag: PermissionFlagsBits.ManageMessages, label: 'manage messages' },
    purgeuntil: { flag: PermissionFlagsBits.ManageMessages, label: 'manage messages' },
    lock:       { flag: PermissionFlagsBits.ManageChannels, label: 'manage channels' },
    unlock:     { flag: PermissionFlagsBits.ManageChannels, label: 'manage channels' },
    lockdown:   { flag: PermissionFlagsBits.ManageChannels, label: 'manage channels' },
    unlockdown: { flag: PermissionFlagsBits.ManageChannels, label: 'manage channels' }
};

module.exports = {
    async handle(interaction, command) {
        const perm = COMMAND_PERMISSIONS[command.name];

        if (!perm) {
            return interaction.reply({ content: '❌ Unknown command permission configuration.', ephemeral: true });
        }

        if (!interaction.member.permissions.has(perm.flag)) {
            return interaction.reply({ content: `❌ You do not have permission to ${perm.label}.`, ephemeral: true });
        }

        if (!interaction.guild.members.me.permissions.has(perm.flag)) {
            return interaction.reply({ content: `❌ I do not have permission to ${perm.label} in this server.`, ephemeral: true });
        }

        await command.executeSlash(interaction);
    }
};
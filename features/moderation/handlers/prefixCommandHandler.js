// features/moderation/handlers/prefixCommandHandler.js
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
    async handle(message, command, args) {
        const perm = COMMAND_PERMISSIONS[command.name];

        if (!perm) {
            return message.reply('❌ Unknown command permission configuration.');
        }

        if (!message.member.permissions.has(perm.flag)) {
            return message.reply(`❌ You do not have permission to ${perm.label}.`);
        }

        if (!message.guild.members.me.permissions.has(perm.flag)) {
            return message.reply(`❌ I do not have permission to ${perm.label} in this server.`);
        }

        await command.executePrefix(message, args);
    }
};
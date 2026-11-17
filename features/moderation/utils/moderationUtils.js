// features/moderation/utils/moderationUtils.js
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const caseService = require('../services/caseService');
const { generateCaseId } = require('./caseID');
const { MOD_LOGS_CHANNEL_ID } = require('../config/moderationConfig');

// ─── canModerate ─────────────────────────────────────────────────────────────
async function canModerate(moderator, target) {
    try {
        if (moderator.id === target.id)
            return { success: false, message: 'You cannot moderate yourself.' };
        if (target.id === target.guild.ownerId)
            return { success: false, message: 'Cannot moderate the server owner.' };
        if (moderator.roles.highest.position <= target.roles.highest.position)
            return { success: false, message: 'You cannot moderate someone with a higher or equal role.' };
        const botMember = target.guild.members.me;
        if (botMember.roles.highest.position <= target.roles.highest.position)
            return { success: false, message: 'I cannot moderate someone with a higher or equal role than me.' };
        return { success: true };
    } catch (error) {
        console.error('Error checking moderation permissions:', error);
        return { success: false, message: 'Error checking permissions.' };
    }
}

// ─── validatePermissions ─────────────────────────────────────────────────────
async function validatePermissions(member, permission) {
    try {
        const permissionFlag = PermissionFlagsBits[permission] || permission;
        if (!member.permissions.has(permissionFlag))
            return { success: false, message: 'You do not have permission to use this command.' };
        const botMember = member.guild.members.me;
        if (!botMember.permissions.has(permissionFlag))
            return { success: false, message: 'I do not have the required permissions to execute this command.' };
        return { success: true };
    } catch (error) {
        console.error('Error validating permissions:', error);
        return { success: false, message: 'Error validating permissions.' };
    }
}

// ─── handleProofData ─────────────────────────────────────────────────────────
async function handleProofData(proofUrl, proofFile) {
    if (!proofUrl && !proofFile) return { data: null, error: null };

    if (proofFile) {
        const maxFileSize = 25 * 1024 * 1024;
        const allowedTypes = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'application/pdf', 'text/plain', 'application/json',
            'video/mp4', 'video/webm'
        ];
        if (proofFile.size > maxFileSize)
            return { data: null, error: 'File size exceeds 25MB limit' };
        if (!allowedTypes.includes(proofFile.contentType))
            return { data: null, error: `File type not allowed. Allowed types: ${allowedTypes.join(', ')}` };
        return {
            data: {
                type: 'file', url: proofFile.url, filename: proofFile.name,
                size: proofFile.size, contentType: proofFile.contentType,
                isImage: proofFile.contentType.startsWith('image/'),
                uploadedAt: new Date().toISOString()
            },
            error: null
        };
    }

    if (proofUrl) {
        try {
            const url = new URL(proofUrl);
            if (!['http:', 'https:'].includes(url.protocol))
                return { data: null, error: 'Only HTTP and HTTPS URLs are allowed' };
            return {
                data: { type: 'url', url: proofUrl, domain: url.hostname, addedAt: new Date().toISOString() },
                error: null
            };
        } catch {
            return { data: null, error: 'Invalid URL format' };
        }
    }

    return { data: null, error: null };
}

// ─── Proof / file formatting helpers ─────────────────────────────────────────
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024, sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatProofDisplay(proofData) {
    if (!proofData) return 'None';
    if (proofData.type === 'file') {
        const emoji = proofData.isImage ? '🖼️' : '📄';
        return `${emoji} [${proofData.filename}](${proofData.url}) (${formatFileSize(proofData.size)})`;
    }
    if (proofData.type === 'url') return `🔗 [View Evidence](${proofData.url})`;
    return 'None';
}

function formatProofForDM(proofData) {
    if (!proofData) return 'None provided';
    if (proofData.type === 'file') return `${proofData.isImage ? '🖼️' : '📄'} **${proofData.filename}**\n[Download](${proofData.url})`;
    if (proofData.type === 'url') return `🔗 [View Evidence](${proofData.url})`;
    return 'None provided';
}

function formatProofForLog(proofData) {
    if (!proofData) return 'None provided';
    if (proofData.type === 'file') {
        const size = formatFileSize(proofData.size);
        return `${proofData.isImage ? '🖼️' : '📄'} **${proofData.filename}** (${size})\n[View File](${proofData.url})\nUploaded: <t:${Math.floor(new Date(proofData.uploadedAt).getTime() / 1000)}:R>`;
    }
    if (proofData.type === 'url') return `🔗 [View Evidence](${proofData.url})\nDomain: ${proofData.domain}\nAdded: <t:${Math.floor(new Date(proofData.addedAt).getTime() / 1000)}:R>`;
    return 'None provided';
}

function formatModeratorField(tagOrUser, id) {
    if (tagOrUser && typeof tagOrUser === 'object') return `${tagOrUser.tag} (${tagOrUser.id})`;
    return `${tagOrUser} (${id})`;
}

// ─── sendDM ──────────────────────────────────────────────────────────────────
// FIX: the outer try/catch is removed. Each caller already wraps sendDM in its
// own try/catch and uses the thrown error to set dmSent=false. Swallowing ALL
// errors here (including malformed-embed errors) was hiding template bugs and
// making dmSent unreliable. Now only the actual user.send() call can throw, and
// callers handle it correctly.
async function sendDM(user, options) {
    const embed = new EmbedBuilder().setTimestamp();
    const modField  = formatModeratorField(options.moderatorTag, options.moderatorId);
    const caseField = options.caseId || 'N/A';

    switch (options.type) {
        case 'ban':
        case 'softban':
            embed.setColor(options.type === 'softban' ? '#ff9500' : '#ff0000')
                .setTitle(options.type === 'softban' ? '🔨 You have been soft banned' : '🔨 You have been banned')
                .setDescription(`You have been ${options.type === 'softban' ? 'soft banned from' : 'banned from'} **${options.guild}**`)
                .addFields(
                    { name: 'Case ID',   value: caseField,     inline: true  },
                    { name: 'Moderator', value: modField,       inline: true  },
                    { name: 'Reason',    value: options.reason, inline: false }
                );
            if (options.duration) embed.addFields({ name: 'Duration', value: options.duration, inline: true });
            if (options.proof) {
                embed.addFields({ name: 'Evidence', value: formatProofForDM(options.proof), inline: false });
                if (options.proof.type === 'file' && options.proof.isImage) embed.setImage(options.proof.url);
            }
            break;

        case 'unban':
            embed.setColor('#00ff00').setTitle('🔓 You have been unbanned')
                .setDescription(`You have been unbanned from **${options.guild}**`)
                .addFields(
                    { name: 'Case ID',   value: caseField,     inline: true  },
                    { name: 'Moderator', value: modField,       inline: true  },
                    { name: 'Reason',    value: options.reason, inline: false }
                );
            break;

        case 'kick':
            embed.setColor('#ff6600').setTitle('👢 You have been kicked')
                .setDescription(`You have been kicked from **${options.guild}**`)
                .addFields(
                    { name: 'Case ID',   value: caseField,     inline: true  },
                    { name: 'Moderator', value: modField,       inline: true  },
                    { name: 'Reason',    value: options.reason, inline: false }
                );
            if (options.proof) {
                embed.addFields({ name: 'Evidence', value: formatProofForDM(options.proof), inline: false });
                if (options.proof.type === 'file' && options.proof.isImage) embed.setImage(options.proof.url);
            }
            break;

        case 'mute':
            embed.setColor('#ffa500').setTitle('🔇 You have been muted')
                .setDescription(`You have been timed out in **${options.guild}**`)
                .addFields(
                    { name: 'Case ID',   value: caseField,                    inline: true  },
                    { name: 'Moderator', value: modField,                      inline: true  },
                    { name: 'Reason',    value: options.reason,                inline: false },
                    { name: 'Duration',  value: options.duration || 'Unknown', inline: true  }
                );
            if (options.expiresAt)
                embed.addFields({ name: 'Expires', value: `<t:${Math.floor(options.expiresAt.getTime() / 1000)}:F>`, inline: false });
            if (options.proof) {
                embed.addFields({ name: 'Evidence', value: formatProofForDM(options.proof), inline: false });
                if (options.proof.type === 'file' && options.proof.isImage) embed.setImage(options.proof.url);
            }
            break;

        case 'unmute':
            embed.setColor('#00ff99').setTitle('🔊 You have been unmuted')
                .setDescription(`Your timeout has been removed in **${options.guild}**`)
                .addFields(
                    { name: 'Case ID',   value: caseField,     inline: true  },
                    { name: 'Moderator', value: modField,       inline: true  },
                    { name: 'Reason',    value: options.reason, inline: false }
                );
            if (options.proof) {
                embed.addFields({ name: 'Evidence', value: formatProofForDM(options.proof), inline: false });
                if (options.proof.type === 'file' && options.proof.isImage) embed.setImage(options.proof.url);
            }
            break;

        case 'warn':
            embed.setColor('#ffcc00').setTitle('⚠️ You have received a warning')
                .setDescription(`You have been warned in **${options.guild}**`)
                .addFields(
                    { name: 'Case ID',   value: caseField,     inline: true  },
                    { name: 'Moderator', value: modField,       inline: true  },
                    { name: 'Reason',    value: options.reason, inline: false }
                );
            if (options.proof) {
                embed.addFields({ name: 'Evidence', value: formatProofForDM(options.proof), inline: false });
                if (options.proof.type === 'file' && options.proof.isImage) embed.setImage(options.proof.url);
            }
            break;

        case 'warn_remove':
            embed.setColor('#00ccff').setTitle('🗑️ A warning has been removed')
                .setDescription(`A warning was removed from your record in **${options.guild}**`)
                .addFields(
                    { name: 'Case ID',            value: caseField,                                        inline: true  },
                    { name: 'Moderator',          value: modField,                                         inline: true  },
                    { name: 'Removal Reason',     value: options.reason,                                   inline: false },
                    { name: 'Original Warning',   value: options.originalReason || 'No reason recorded',  inline: false },
                    { name: 'Remaining Warnings', value: `${options.remaining}`,                          inline: true  }
                );
            if (options.proof) {
                embed.addFields({ name: 'Evidence', value: formatProofForDM(options.proof), inline: false });
                if (options.proof.type === 'file' && options.proof.isImage) embed.setImage(options.proof.url);
            }
            break;

        default:
            // FIX: throw so the caller's try/catch records dmSent=false and the
            // broken template is visible in logs rather than silently swallowed.
            throw new Error(`sendDM called with unknown type: ${options.type}`);
    }

    // Let this throw — callers catch it and set dmSent=false accordingly.
    await user.send({ embeds: [embed] });
}

// ─── logModeration ───────────────────────────────────────────────────────────
async function logModeration(guild, action) {
    const caseId = action.caseId || generateCaseId(action.type);

    // Record in the moderation database first: it must not depend on a log channel being set up.
    try { await caseService.record(guild.id, action, caseId); }
    catch (e) { console.error('[logModeration] could not record case', caseId, e); }

    try {
        // Dashboard choice > MOD_LOGS_CHANNEL_ID > a channel named like "mod-logs" (see features/logging/config.js).
        const logChannel = require('../../logging/config').logChannel(guild, 'mod');
        if (!logChannel) return caseId;

        const embed = new EmbedBuilder().setTimestamp().setFooter({ text: `Case ID: ${caseId}` });
        const modValue    = `${action.moderator.tag} (${action.moderator.id})`;
        const targetValue = `${action.target.tag} (${action.target.id})`;

        switch (action.type) {
            case 'ban':
                embed.setColor('#ff0000').setTitle('🔨 Member Banned').addFields(
                    { name: 'Case ID',   value: caseId,        inline: true  },
                    { name: 'User',      value: targetValue,   inline: true  },
                    { name: 'Moderator', value: modValue,      inline: true  },
                    { name: 'Reason',    value: action.reason, inline: false }
                );
                if (action.duration)       embed.addFields({ name: 'Duration',         value: action.duration, inline: true });
                if (action.expiresAt)      embed.addFields({ name: 'Expires',          value: `<t:${Math.floor(action.expiresAt.getTime()/1000)}:F>`, inline: true });
                if (action.purge_days > 0) embed.addFields({ name: 'Messages Deleted', value: `${action.purge_days} days`, inline: true });
                if (action.proof) { embed.addFields({ name: 'Evidence', value: formatProofForLog(action.proof), inline: false }); if (action.proof.type === 'file' && action.proof.isImage) embed.setThumbnail(action.proof.url); }
                break;

            case 'softban':
                embed.setColor('#ff9500').setTitle('🔨 Member Soft Banned').addFields(
                    { name: 'Case ID',   value: caseId,        inline: true  },
                    { name: 'User',      value: targetValue,   inline: true  },
                    { name: 'Moderator', value: modValue,      inline: true  },
                    { name: 'Reason',    value: action.reason, inline: false }
                );
                if (action.purge_days > 0) embed.addFields({ name: 'Messages Deleted', value: `${action.purge_days} days`, inline: true });
                if (action.proof) { embed.addFields({ name: 'Evidence', value: formatProofForLog(action.proof), inline: false }); if (action.proof.type === 'file' && action.proof.isImage) embed.setThumbnail(action.proof.url); }
                break;

            case 'unban':
                embed.setColor('#00ff00').setTitle('🔓 Member Unbanned').addFields(
                    { name: 'Case ID',   value: caseId,        inline: true  },
                    { name: 'User',      value: targetValue,   inline: true  },
                    { name: 'Moderator', value: modValue,      inline: true  },
                    { name: 'Reason',    value: action.reason, inline: false }
                );
                break;

            case 'kick':
                embed.setColor('#ff6600').setTitle('👢 Member Kicked').addFields(
                    { name: 'Case ID',   value: caseId,        inline: true  },
                    { name: 'User',      value: targetValue,   inline: true  },
                    { name: 'Moderator', value: modValue,      inline: true  },
                    { name: 'Reason',    value: action.reason, inline: false }
                );
                if (action.proof) { embed.addFields({ name: 'Evidence', value: formatProofForLog(action.proof), inline: false }); if (action.proof.type === 'file' && action.proof.isImage) embed.setThumbnail(action.proof.url); }
                break;

            case 'mute':
                embed.setColor('#ffa500').setTitle('🔇 Member Muted').addFields(
                    { name: 'Case ID',   value: caseId,                       inline: true  },
                    { name: 'User',      value: targetValue,                  inline: true  },
                    { name: 'Moderator', value: modValue,                     inline: true  },
                    { name: 'Reason',    value: action.reason,                inline: false },
                    { name: 'Duration',  value: action.duration || 'Unknown', inline: true  }
                );
                if (action.expiresAt) embed.addFields({ name: 'Expires', value: `<t:${Math.floor(action.expiresAt.getTime()/1000)}:F>`, inline: true });
                if (action.proof) { embed.addFields({ name: 'Evidence', value: formatProofForLog(action.proof), inline: false }); if (action.proof.type === 'file' && action.proof.isImage) embed.setThumbnail(action.proof.url); }
                break;

            case 'unmute':
                embed.setColor('#00ff99').setTitle('🔊 Member Unmuted').addFields(
                    { name: 'Case ID',   value: caseId,        inline: true  },
                    { name: 'User',      value: targetValue,   inline: true  },
                    { name: 'Moderator', value: modValue,      inline: true  },
                    { name: 'Reason',    value: action.reason, inline: false }
                );
                if (action.proof) { embed.addFields({ name: 'Evidence', value: formatProofForLog(action.proof), inline: false }); if (action.proof.type === 'file' && action.proof.isImage) embed.setThumbnail(action.proof.url); }
                break;

            case 'purge':
                embed.setColor('#8e8e93').setTitle('🧹 Messages Purged').addFields(
                    { name: 'Channel',   value: `<#${action.target.id}>`,   inline: true  },
                    { name: 'Deleted',   value: `${action.count ?? 0}`,     inline: true  },
                    { name: 'Moderator', value: modValue,                   inline: true  },
                    { name: 'Details',   value: action.reason,              inline: false }
                );
                break;

            case 'warn':
                embed.setColor('#ffcc00').setTitle('⚠️ Member Warned').addFields(
                    { name: 'Case ID',        value: caseId,                             inline: true  },
                    { name: 'User',           value: targetValue,                        inline: true  },
                    { name: 'Moderator',      value: modValue,                           inline: true  },
                    { name: 'Reason',         value: action.reason,                      inline: false },
                    { name: 'Total Warnings', value: `${action.totalWarnings}`,          inline: true  },
                    { name: 'Severity',       value: `${action.severity ?? 0}`,          inline: true  },
                    { name: 'Points',         value: `${action.points ?? 0}`,            inline: true  },
                    { name: 'DM Sent',        value: action.dmSent ? '✅ Yes' : '❌ No', inline: true  }
                );
                if (action.proof) { embed.addFields({ name: 'Evidence', value: formatProofForLog(action.proof), inline: false }); if (action.proof.type === 'file' && action.proof.isImage) embed.setThumbnail(action.proof.url); }
                break;

            case 'warn_remove':
                embed.setColor('#00ccff').setTitle('🗑️ Warning Removed').addFields(
                    { name: 'Case ID',            value: caseId,                                               inline: true  },
                    { name: 'Removed Warn ID',    value: action.removedCaseId || 'N/A',                        inline: true  },
                    { name: 'User',               value: targetValue,                                          inline: true  },
                    { name: 'Moderator',          value: modValue,                                             inline: true  },
                    { name: 'Removal Reason',     value: action.reason,                                        inline: false },
                    { name: 'Original Warning',   value: action.originalReason || 'No reason recorded',       inline: false },
                    { name: 'Remaining Warnings', value: `${action.remaining}`,                                inline: true  },
                    { name: 'DM Sent',            value: action.dmSent ? '✅ Yes' : '❌ No',                  inline: true  }
                );
                if (action.proof) { embed.addFields({ name: 'Evidence', value: formatProofForLog(action.proof), inline: false }); if (action.proof.type === 'file' && action.proof.isImage) embed.setThumbnail(action.proof.url); }
                break;

            default:
                console.warn(`[logModeration] Unknown action type: "${action.type}". Skipping log to avoid empty embed rejection.`);
                return caseId;
        }

        await logChannel.send({ embeds: [embed] });
        if (action.type === 'warn' && action.thresholdCrossed) {
            await logChannel.send({ embeds: [new EmbedBuilder().setColor('#ff3b30').setTitle('🚨 Warning threshold reached')
                .setDescription(`${targetValue} now has **${action.points}** warning points (threshold ${action.threshold}). Latest: \`${caseId}\` — ${action.reason}\n\nConsider a mute, kick or ban. History: \`/case history\`.`)
                .setTimestamp()] });
        }
    } catch (error) {
        console.error('Failed to log moderation action:', error);
    }

    return caseId;
}

// ─── parseMembers ────────────────────────────────────────────────────────────
async function parseMembers(guild, input, allowHackBan = false) {
    const ids = input.split(/[\s,]+/).filter(Boolean);
    if (!ids.length) return { success: false, message: 'No users provided', targets: [] };

    const targets = [];
    const failed  = [];

    for (const idOrTag of ids) {
        try {
            let userId = null;

            if (/^\d{17,19}$/.test(idOrTag)) {
                userId = idOrTag;
            } else if (idOrTag.match(/^<@!?(\d+)>$/)) {
                userId = idOrTag.match(/^<@!?(\d+)>$/)[1];
            } else {
                failed.push({ id: idOrTag, user: null, reason: `Invalid user format: ${idOrTag}` });
                continue;
            }

            const user   = await guild.client.users.fetch(userId);
            const member = await guild.members.fetch(userId).catch(() => null);

            if (!member && !allowHackBan) {
                failed.push({ id: userId, user, reason: `${user.tag} is not in the server.` });
                continue;
            }

            targets.push({ user, member });
        } catch (error) {
            failed.push({ id: idOrTag, user: null, reason: `Failed to resolve user: ${idOrTag}` });
        }
    }

    if (targets.length === 0 && failed.length > 0) {
        const reasons = failed.map(f => f.reason).join(', ');
        return { success: false, message: reasons, targets: [], failed };
    }

    return { success: true, targets, failed };
}

module.exports = {
    canModerate,
    validatePermissions,
    sendDM,
    logModeration,
    parseMembers,
    handleProofData,
    formatProofDisplay,
    formatProofForDM,
    formatProofForLog,
    formatFileSize
};
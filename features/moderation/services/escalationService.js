// features/moderation/services/escalationService.js
// Automatic punishments when a member's warning points reach a tier (set on the dashboard).
// Only the highest tier crossed by this warning is applied. Nook acts as the moderator.
const { EmbedBuilder } = require('discord.js');
const modSettings = require('./modSettingsService');
const { parseDuration, formatDuration } = require('../utils/durationParser');
const { generateCaseId } = require('../utils/caseID');
const { sendDM, logModeration } = require('../utils/moderationUtils');

const VERB = { mute: 'muted', kick: 'kicked', ban: 'banned' };

function crossedTier(settings, before, after) {
    if (!settings.escalation?.enabled) return null;
    const hit = [...settings.escalation.tiers].filter(t => before < t.points && after >= t.points).sort((a, b) => a.points - b.points);
    return hit.length ? hit[hit.length - 1] : null;
}

async function failed(guild, user, tier, why, points) {
    try {
        const { send } = require('../../logging/config');
        await send(guild, 'mod', new EmbedBuilder().setColor('#ff9500').setTitle('⚠️ Automatic action failed')
            .setDescription(`${user.tag} (${user.id}) reached **${points}** warning points, which should trigger an automatic **${tier.action}**, but it couldn't be done: ${why}`).setTimestamp());
    } catch { /* logging must never break a warn */ }
}

async function maybeEscalate(guild, member, user, pointsBefore, pointsAfter, warnCaseId, client) {
    const tier = crossedTier(modSettings.get(guild.id), pointsBefore, pointsAfter);
    if (!tier) return null;
    const label = `${tier.action} at ${tier.points} points`;
    const me = guild.members.me;
    try {
        if (!member) { await failed(guild, user, tier, 'they are no longer in the server', pointsAfter); return { ok: false, text: `Automatic ${label} skipped: member left.` }; }
        if (member.id === guild.ownerId) { await failed(guild, user, tier, 'they own the server', pointsAfter); return { ok: false, text: `Automatic ${label} skipped: server owner.` }; }
        if (me.roles.highest.position <= member.roles.highest.position) { await failed(guild, user, tier, 'their top role is not below Nook’s role', pointsAfter); return { ok: false, text: `Automatic ${label} failed: role hierarchy.` }; }

        const reason = `Automatic: reached ${pointsAfter} warning points (latest ${warnCaseId})`;
        let duration = null, expiresAt = null, ms = null;
        if (tier.action === 'mute') {
            const p = parseDuration(tier.duration || '1h');
            ms = p.success && p.ms ? Math.min(p.ms, modSettings.LIMITS.MUTE_MAX_MS) : 60 * 60 * 1000;
            duration = formatDuration(tier.duration || '1h'); expiresAt = new Date(Date.now() + ms);
        } else if (tier.action === 'ban' && tier.duration) {
            const p = parseDuration(tier.duration);
            if (p.success) { duration = p.duration; expiresAt = p.ms ? new Date(Date.now() + p.ms) : null; }
        }
        const caseId = generateCaseId(tier.action);
        let dmSent = false;
        try { await sendDM(user, { type: tier.action, guild: guild.name, reason, duration, moderatorTag: client.user.tag, moderatorId: client.user.id, caseId }); dmSent = true; } catch { /* DMs closed */ }

        if (tier.action === 'mute') await member.timeout(ms, reason);
        else if (tier.action === 'kick') await member.kick(reason);
        else await guild.members.ban(user, { reason, deleteMessageSeconds: 0 });

        await logModeration(guild, { type: tier.action, caseId, target: user, moderator: client.user, reason, duration, expiresAt, dmSent });
        return { ok: true, action: tier.action, caseId, text: `Automatic ${tier.action} applied (${pointsAfter} points): \`${caseId}\`${duration ? ` for ${duration}` : ''}.` };
    } catch (e) {
        console.error('[escalation] failed:', e);
        await failed(guild, user, tier, e.message || 'unknown error', pointsAfter);
        return { ok: false, text: `Automatic ${label} failed: ${e.message}` };
    }
}

module.exports = { maybeEscalate, crossedTier, VERB };

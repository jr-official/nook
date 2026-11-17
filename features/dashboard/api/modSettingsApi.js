// features/dashboard/api/modSettingsApi.js — Moderation settings: warning points, automatic escalation,
// and which roles can still talk in locked channels.
const modSettings = require('../../moderation/services/modSettingsService');
const lockService = require('../../moderation/services/lockService');
const { parseDuration } = require('../../moderation/utils/durationParser');
const { HttpError } = require('../services/guildAccess');

const { LIMITS } = modSettings;
const bad = msg => new HttpError(400, 'invalid', msg);
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const ACTIONS = ['mute', 'kick', 'ban'];

async function view(guild) {
    const s = modSettings.get(guild.id);
    const roles = [...guild.roles.cache.values()].filter(r => r.id !== guild.id && !r.managed)
        .sort((a, b) => b.position - a.position)
        .map(r => ({ id: r.id, name: r.name, color: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : null }));
    const locks = await lockService.list(guild.id);
    return {
        settings: s,
        roles,
        locked: locks.map(l => ({
            channelId: l.channelId, name: guild.channels.cache.get(l.channelId)?.name ?? null, reason: l.reason || null,
            by: l.lockedByTag ?? null, lockedAt: new Date(l.lockedAt).toISOString(), expiresAt: l.expiresAt ? new Date(l.expiresAt).toISOString() : null, lockdown: !!l.lockdown
        })),
        limits: LIMITS
    };
}

function validateTiers(raw) {
    if (!Array.isArray(raw) || raw.length > LIMITS.MAX_TIERS) throw bad(`Use at most ${LIMITS.MAX_TIERS} steps.`);
    const seen = new Set(), out = [];
    for (const t of raw) {
        if (!t || typeof t !== 'object') throw bad('Each step needs points and an action.');
        if (!isInt(t.points, 1, LIMITS.MAX_POINTS)) throw bad(`Points must be a whole number from 1 to ${LIMITS.MAX_POINTS}.`);
        if (seen.has(t.points)) throw bad('Two steps can’t use the same number of points.');
        seen.add(t.points);
        if (!ACTIONS.includes(t.action)) throw bad('Action must be mute, kick or ban.');
        let duration = typeof t.duration === 'string' ? t.duration.trim() : null;
        if (t.action === 'kick') duration = null;
        else if (t.action === 'mute') {
            const p = parseDuration(duration || '');
            if (!p.success || !p.ms) throw bad('A mute needs a length like 30m, 2h or 1d.');
            if (p.ms > LIMITS.MUTE_MAX_MS) throw bad('A mute can last at most 28 days.');
        } else if (duration) {
            const p = parseDuration(duration);
            if (!p.success) throw bad('Ban length must look like 7d, 2w, or permanent.');
        } else duration = 'permanent';
        out.push({ points: t.points, action: t.action, duration });
    }
    return out.sort((a, b) => a.points - b.points);
}

async function getModSettings({ guild }) { return view(guild); }

async function putModSettings({ guild, body }) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('Send a JSON object.');
    for (const k of Object.keys(body)) if (!['warnAlertPoints', 'decayDays', 'escalation', 'lockStaffRoles'].includes(k)) throw bad(`Unknown setting "${k}".`);
    const patch = {};
    if (body.warnAlertPoints !== undefined) { if (!isInt(body.warnAlertPoints, 0, LIMITS.MAX_POINTS)) throw bad(`Alert points must be 0 (off) to ${LIMITS.MAX_POINTS}.`); patch.warnAlertPoints = body.warnAlertPoints; }
    if (body.decayDays !== undefined) { if (!isInt(body.decayDays, 0, LIMITS.MAX_DECAY_DAYS)) throw bad(`Decay must be 0 (never) to ${LIMITS.MAX_DECAY_DAYS} days.`); patch.decayDays = body.decayDays; }
    if (body.escalation !== undefined) {
        const e = body.escalation;
        if (!e || typeof e !== 'object' || typeof e.enabled !== 'boolean') throw bad('escalation needs enabled and tiers.');
        patch.escalation = { enabled: e.enabled, tiers: validateTiers(e.tiers) };
        if (patch.escalation.enabled && !patch.escalation.tiers.length) throw bad('Add at least one step before turning escalation on.');
    }
    if (body.lockStaffRoles !== undefined) {
        const r = body.lockStaffRoles;
        if (!Array.isArray(r) || r.length > LIMITS.MAX_STAFF_ROLES) throw bad(`Pick up to ${LIMITS.MAX_STAFF_ROLES} roles.`);
        for (const id of r) if (typeof id !== 'string' || !guild.roles.cache.has(id) || id === guild.id) throw bad('One of those roles doesn’t exist in this server.');
        patch.lockStaffRoles = [...new Set(r)];
    }
    await modSettings.save(guild.id, patch);
    console.log(`\u{1F6E1}️ [dashboard] moderation settings saved in guild ${guild.id}`);
    return view(guild);
}

module.exports = { getModSettings, putModSettings };

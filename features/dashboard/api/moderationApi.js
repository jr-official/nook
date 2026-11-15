// features/dashboard/api/moderationApi.js
// Read-only overview of a server's warnings. No DM-sent flags, proof links or moderator IDs are returned.
const warningService = require('../../moderation/services/warningService');

const RECENT = 25;
const TOP = 5;
const trim = (s, n) => String(s ?? '').slice(0, n);

// One batched lookup for the current display names; falls back to the name stored with the warning.
async function namesFor(guild, ids) {
    const found = new Map();
    if (!ids.length) return found;
    let members = guild.members.cache;
    try { members = await guild.members.fetch({ user: ids, time: 5000 }); } catch { /* cache only */ }
    for (const id of ids) { const m = members.get(id); if (m) found.set(id, m.displayName); }
    return found;
}

async function getModeration({ guild }) {
    const col = warningService._col();
    const [total, recentDocs, board] = await Promise.all([
        col.countDocuments({ guildId: guild.id, active: true }),
        col.find({ guildId: guild.id, active: true }).sort({ createdAt: -1 }).limit(RECENT).toArray(),
        warningService.getGuildLeaderboard(guild.id)
    ]);
    const top = board.slice(0, TOP);
    const ids = [...new Set([...recentDocs.map(d => d.userId), ...top.map(t => t.userId)].filter(Boolean))];
    const names = await namesFor(guild, ids);
    return {
        total,
        warnedMembers: board.length,
        recent: recentDocs.map(d => ({
            caseId: d.caseId ?? null,
            userId: d.userId,
            username: names.get(d.userId) ?? d.username ?? null,
            moderator: d.moderatorTag ?? null,
            reason: trim(d.reason, 300),
            createdAt: new Date(d.createdAt).toISOString()
        })),
        top: top.map(t => ({ userId: t.userId, username: names.get(t.userId) ?? t.username ?? null, count: t.count }))
    };
}

module.exports = { getModeration };

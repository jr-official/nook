// features/dashboard/api/moderationApi.js
// Read-only overview of a server's warnings. No DM-sent flags, proof links or moderator IDs are returned.
const warningService = require('../../moderation/services/warningService');
const { HttpError } = require('../services/guildAccess');
const { PAGE_SIZE, escapeRegex, parsePage, parseQ, parseSnowflake, iso, namesFor } = require('./_listing');

const RECENT = 25;
const TOP = 5;
const trim = (s, n) => String(s ?? '').slice(0, n);
const DAYS = 14;

// Warnings per UTC day for the last DAYS days (oldest first, zeros filled).
async function lastDays(col, guildId) {
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const start = new Date(+today - (DAYS - 1) * 86400000);
    const docs = await col.find({ guildId, active: true, createdAt: { $gte: start } }).sort({ createdAt: -1 }).limit(5000).toArray();
    const counts = new Map();
    for (const d of docs) { const k = iso(d.createdAt)?.slice(0, 10); if (k) counts.set(k, (counts.get(k) ?? 0) + 1); }
    return Array.from({ length: DAYS }, (_, i) => { const date = new Date(+start + i * 86400000).toISOString().slice(0, 10); return { date, count: counts.get(date) ?? 0 }; });
}

async function getModeration({ guild }) {
    const col = warningService._col();
    const [total, recentDocs, board, byDay] = await Promise.all([
        col.countDocuments({ guildId: guild.id, active: true }),
        col.find({ guildId: guild.id, active: true }).sort({ createdAt: -1 }).limit(RECENT).toArray(),
        warningService.getGuildLeaderboard(guild.id),
        lastDays(col, guild.id)
    ]);
    const top = board.slice(0, TOP);
    const ids = [...new Set([...recentDocs.map(d => d.userId), ...top.map(t => t.userId)].filter(Boolean))];
    const names = await namesFor(guild, ids);
    return {
        total,
        warnedMembers: board.length,
        byDay,
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

const row = (d, names) => ({
    caseId: d.caseId ?? null,
    userId: d.userId,
    username: names.get(d.userId) ?? d.username ?? null,
    moderator: d.moderatorTag ?? null,
    reason: trim(d.reason, 300),
    createdAt: iso(d.createdAt)
});

// GET /moderation/warnings?page=&q=&userId=  (q: case id, reason text or the stored member tag)
async function listWarnings({ guild, query }) {
    const page = parsePage(query.get('page'));
    const q = parseQ(query.get('q'));
    const userId = parseSnowflake(query.get('userId'), 'userId');
    const filter = { guildId: guild.id, active: true };
    if (userId) filter.userId = userId;
    if (q) {
        const part = escapeRegex(q);
        filter.$or = [
            { caseId: { $regex: `^${part}$`, $options: 'i' } },
            { reason: { $regex: part, $options: 'i' } },
            { username: { $regex: part, $options: 'i' } }
        ];
    }
    const col = warningService._col();
    const [total, docs] = await Promise.all([
        col.countDocuments(filter),
        col.find(filter).sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).toArray()
    ]);
    const names = await namesFor(guild, [...new Set(docs.map(d => d.userId).filter(Boolean))]);
    return { total, page, pageSize: PAGE_SIZE, rows: docs.map(d => row(d, names)) };
}

// DELETE /moderation/warnings/:caseId  (guild-scoped soft delete, same as the in-Discord removal)
async function removeWarning({ guild, session, params }) {
    const caseId = String(params.caseId ?? '');
    if (!/^[A-Za-z0-9-]{1,32}$/.test(caseId)) throw new HttpError(400, 'invalid', 'That isn\u2019t a valid case id.');
    const removed = await warningService.removeByCaseId(guild.id, caseId, session.userId);
    if (!removed) throw new HttpError(404, 'not_found', 'No active warning with that case id in this server.');
    const total = await warningService._col().countDocuments({ guildId: guild.id, active: true });
    console.log(`\u{1F6E1}\uFE0F [dashboard] ${session.userId} removed warning ${caseId} in guild ${guild.id}`);
    return { ok: true, caseId, total };
}

module.exports = { getModeration, listWarnings, removeWarning };

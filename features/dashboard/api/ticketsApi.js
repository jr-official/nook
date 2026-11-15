// features/dashboard/api/ticketsApi.js
// Read-only ticket overview. Tickets are stored with their guildId, so every query is scoped to the server.
const databaseService = require('../../tickets/services/databaseService');
const { HttpError } = require('../services/guildAccess');
const { PAGE_SIZE, escapeRegex, parsePage, parseQ, iso, namesFor } = require('./_listing');

const RECENT = 25;

async function getTickets({ guild }) {
    const col = databaseService.getCollection('tickets');
    const [open, closed, docs, kinds] = await Promise.all([
        col.countDocuments({ guildId: guild.id, status: 'open' }),
        col.countDocuments({ guildId: guild.id, status: 'closed' }),
        col.find({ guildId: guild.id }).sort({ createdAt: -1 }).limit(RECENT).toArray(),
        col.aggregate([
            { $match: { guildId: guild.id } },
            { $group: { _id: { $ifNull: ['$ticketType', '$type'] }, count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } }
        ]).toArray()
    ]);
    const byType = kinds.map(k => ({ type: typeof k._id === 'string' && k._id ? k._id : 'ticket', count: k.count }));
    const ids = [...new Set(docs.map(d => d.userId).filter(Boolean))];
    let members = guild.members.cache;
    if (ids.length) { try { members = await guild.members.fetch({ user: ids, time: 5000 }); } catch { /* cache only */ } }
    return {
        stats: { open, closed, total: open + closed },
        byType,
        types: byType.map(k => k.type),
        recent: docs.map(d => ({
            channelId: d.channelId,
            type: d.ticketType ?? d.type ?? 'ticket',
            userId: d.userId,
            username: members.get(d.userId)?.displayName ?? d.username ?? null,
            status: d.status === 'closed' ? 'closed' : 'open',
            createdAt: new Date(d.createdAt).toISOString()
        }))
    };
}

const STATUSES = new Set(['open', 'closed', 'all']);

// GET /tickets/list?status=&type=&page=&q=  (q: channel id, member id, member tag or ticket type)
async function listTickets({ guild, query }) {
    const page = parsePage(query.get('page'));
    const status = query.get('status') || 'all';
    if (!STATUSES.has(status)) throw new HttpError(400, 'invalid', 'status must be open, closed or all.');
    const type = parseQ(query.get('type'));
    const q = parseQ(query.get('q'));
    const and = [];
    const filter = { guildId: guild.id };
    if (status !== 'all') filter.status = status;
    if (type) and.push({ $or: [{ ticketType: type }, { type }] });
    if (q) {
        const part = escapeRegex(q);
        const ors = [{ username: { $regex: part, $options: 'i' } }, { ticketType: { $regex: part, $options: 'i' } }];
        if (/^\d{15,25}$/.test(q)) ors.push({ channelId: q }, { userId: q });
        and.push({ $or: ors });
    }
    if (and.length) filter.$and = and;
    const col = databaseService.getCollection('tickets');
    const [total, docs] = await Promise.all([
        col.countDocuments(filter),
        col.find(filter).sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).toArray()
    ]);
    const names = await namesFor(guild, [...new Set(docs.map(d => d.userId).filter(Boolean))]);
    return {
        total, page, pageSize: PAGE_SIZE,
        rows: docs.map(d => ({
            channelId: d.channelId,
            type: d.ticketType ?? d.type ?? 'ticket',
            userId: d.userId,
            username: names.get(d.userId) ?? d.username ?? null,
            status: d.status === 'closed' ? 'closed' : 'open',
            createdAt: iso(d.createdAt),
            closedAt: d.closedAt ? iso(d.closedAt) : null,
            channelName: guild.channels?.cache?.get(d.channelId)?.name ?? null
        }))
    };
}

module.exports = { getTickets, listTickets };

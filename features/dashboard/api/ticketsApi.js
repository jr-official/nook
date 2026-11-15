// features/dashboard/api/ticketsApi.js
// Read-only ticket overview. Tickets are stored with their guildId, so every query is scoped to the server.
const databaseService = require('../../tickets/services/databaseService');

const RECENT = 25;

async function getTickets({ guild }) {
    const col = databaseService.getCollection('tickets');
    const [open, closed, docs] = await Promise.all([
        col.countDocuments({ guildId: guild.id, status: 'open' }),
        col.countDocuments({ guildId: guild.id, status: 'closed' }),
        col.find({ guildId: guild.id }).sort({ createdAt: -1 }).limit(RECENT).toArray()
    ]);
    const ids = [...new Set(docs.map(d => d.userId).filter(Boolean))];
    let members = guild.members.cache;
    if (ids.length) { try { members = await guild.members.fetch({ user: ids, time: 5000 }); } catch { /* cache only */ } }
    return {
        stats: { open, closed, total: open + closed },
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

module.exports = { getTickets };

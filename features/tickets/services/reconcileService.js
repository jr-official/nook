// features/tickets/services/reconcileService.js
//
// Keeps the tickets collection honest when a ticket channel disappears without going through
// the "Delete" button (staff deleting the channel by hand, a category purge, another bot).
// Without this a ticket stays "open" forever, which also counts against the member's ticket limit.
//
//   • channelDelete  → the ticket for that channel is closed immediately.
//   • reconcile()    → on start-up and every 30 minutes, open tickets whose channel Discord says
//                      no longer exists (error 10003) are closed. Any other error (network, missing
//                      access, guild outage) leaves the ticket alone: we only act on a clear "gone".

const { Events } = require('discord.js');
const databaseService = require('./databaseService');

const UNKNOWN_CHANNEL = 10003;
const BATCH = 200;
const EVERY_MS = 30 * 60 * 1000;

async function markClosed(filter, reason) {
    const col = databaseService.getCollection('tickets');
    return col.updateMany(
        { ...filter, status: { $ne: 'closed' } },
        { $set: { status: 'closed', closedAt: new Date(), closedReason: reason } }
    );
}

async function reconcile(client, { limit = BATCH } = {}) {
    const col = databaseService.getCollection('tickets');
    const open = await col.find({ status: { $ne: 'closed' } }).limit(limit).toArray();
    const gone = [];
    let checked = 0;
    for (const t of open) {
        const guild = client.guilds.cache.get(t.guildId);
        if (!guild || guild.available === false) continue;   // not our guild right now: say nothing
        checked++;
        try {
            await client.channels.fetch(t.channelId);
        } catch (e) {
            if (e && e.code === UNKNOWN_CHANNEL) gone.push(t.channelId);
        }
    }
    if (gone.length) await markClosed({ channelId: { $in: gone } }, 'channel_missing');
    return { checked, closed: gone.length };
}

function start(client) {
    client.on(Events.ChannelDelete, channel => {
        if (!channel.guildId) return;
        markClosed({ channelId: channel.id }, 'channel_deleted').catch(err => console.error('❌ Ticket close on channel delete failed:', err.message));
    });

    const run = () => reconcile(client)
        .then(r => { if (r.closed) console.log(`🧹 Closed ${r.closed} ticket(s) whose channel no longer exists`); })
        .catch(err => console.error('❌ Ticket reconcile failed:', err.message));

    const go = () => {
        setTimeout(run, 20 * 1000).unref?.();
        setInterval(run, EVERY_MS).unref?.();
    };
    if (client.isReady?.()) go(); else client.once(Events.ClientReady, go);
}

module.exports = { start, reconcile, markClosed };

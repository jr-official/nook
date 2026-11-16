// features/moderation/services/expiryService.js
// Lifts temporary bans when they expire. Runs shortly after ready and every minute; state lives in
// the case database, so a restart never loses a pending unban.
const caseService = require('./caseService');
const { generateCaseId } = require('../utils/caseID');
const { logModeration } = require('../utils/moderationUtils');

const TICK_MS = 60 * 1000;
let running = false;

async function tick(client) {
    if (running) return 0;
    running = true;
    let lifted = 0;
    try {
        for (const c of await caseService.dueBans()) {
            const guild = client.guilds.cache.get(c.guildId);
            if (!guild?.available) continue;            // retry next tick
            try {
                await guild.members.unban(c.userId, `Temporary ban expired (${c.caseId})`);
            } catch (e) {
                if (e.code !== 10026) { console.error(`[expiry] unban ${c.caseId} failed:`, e.message); continue; }
                // 10026 = not banned any more (someone unbanned by hand): just close the case.
            }
            await caseService.markExpired(c);
            // Goes through logModeration so it is recorded as a case and posted to the mod log.
            await logModeration(guild, {
                type: 'unban', caseId: generateCaseId('unban'), reason: `Temporary ban expired (${c.caseId})`,
                target: { id: c.userId, tag: c.username }, moderator: { id: client.user.id, tag: client.user.tag }
            });
            lifted++;
        }
    } catch (e) {
        console.error('[expiry] tick failed:', e);
    } finally { running = false; }
    return lifted;
}

function start(client) {
    setTimeout(() => tick(client), 15 * 1000).unref();
    setInterval(() => tick(client), TICK_MS).unref();
}

module.exports = { start, tick };

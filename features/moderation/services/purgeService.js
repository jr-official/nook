// features/moderation/services/purgeService.js
// Collects and bulk-deletes messages. Discord only bulk-deletes messages younger than 14 days;
// pinned messages are always kept.
const MAX_COUNT = 500;       // /purge
const MAX_UNTIL = 1000;      // /purgeuntil
const FOURTEEN_DAYS = 14 * 86400000 - 60 * 1000;   // a minute of margin

const LINK = /^https?:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)\/?$/;
function parseMessageLink(text) {
    const m = LINK.exec(String(text ?? '').trim());
    return m ? { guildId: m[1], channelId: m[2], messageId: m[3] } : null;
}

const youngEnough = (m, now) => now - m.createdTimestamp < FOURTEEN_DAYS;

// The latest `count` deletable messages (newest first).
async function collectLast(channel, count, now = Date.now()) {
    const out = []; let before;
    while (out.length < count) {
        const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
        if (!page.size) break;
        const arr = [...page.values()];
        before = arr[arr.length - 1].id;
        let hitOld = false;
        for (const m of arr) {
            if (!youngEnough(m, now)) { hitOld = true; continue; }
            if (!m.pinned) out.push(m);
            if (out.length >= count) break;
        }
        if (hitOld || page.size < 100) break;
    }
    return out;
}

// Every deletable message from `messageId` (inclusive) to the newest. Returns {messages, tooOld, truncated}.
async function collectUntil(channel, messageId, now = Date.now()) {
    let anchor;
    try { anchor = await channel.messages.fetch(messageId); } catch { return { notFound: true, messages: [] }; }
    if (!youngEnough(anchor, now)) return { tooOld: true, messages: [] };
    const all = [anchor]; let after = anchor.id;
    while (all.length < MAX_UNTIL) {
        const page = await channel.messages.fetch({ limit: 100, after });
        if (!page.size) break;
        const arr = [...page.values()].sort((a, b) => (a.createdTimestamp - b.createdTimestamp) || (a.id < b.id ? -1 : 1));
        all.push(...arr);
        after = arr[arr.length - 1].id;
        if (page.size < 100) break;
    }
    const truncated = all.length > MAX_UNTIL;
    return { messages: all.slice(0, MAX_UNTIL).filter(m => !m.pinned), truncated };
}

async function deleteAll(channel, messages) {
    let deleted = 0;
    for (let i = 0; i < messages.length; i += 100) {
        const ids = messages.slice(i, i + 100).map(m => m.id);
        if (ids.length === 1) { try { await channel.messages.delete(ids[0]); deleted++; } catch { /* already gone */ } continue; }
        const res = await channel.bulkDelete(ids, true);
        deleted += res.size ?? ids.length;
    }
    return deleted;
}

module.exports = { parseMessageLink, collectLast, collectUntil, deleteAll, MAX_COUNT, MAX_UNTIL };

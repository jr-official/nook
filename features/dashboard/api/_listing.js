// features/dashboard/api/_listing.js
// Small helpers shared by the moderation and tickets list endpoints.
const { HttpError } = require('../services/guildAccess');

const PAGE_SIZE = 20;
const MAX_PAGE = 500;
const MAX_Q = 60;
const SNOWFLAKE = /^\d{15,25}$/;

const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function parsePage(raw) {
    if (raw == null || raw === '') return 1;
    if (!/^\d{1,4}$/.test(String(raw))) throw new HttpError(400, 'invalid', 'page must be a whole number.');
    const n = Number(raw);
    if (n < 1 || n > MAX_PAGE) throw new HttpError(400, 'invalid', `page must be between 1 and ${MAX_PAGE}.`);
    return n;
}

// Trimmed search text, capped so nobody can send a giant pattern. Empty -> null.
const parseQ = raw => { const q = String(raw ?? '').trim().slice(0, MAX_Q); return q || null; };

function parseSnowflake(raw, name) {
    if (raw == null || raw === '') return null;
    if (!SNOWFLAKE.test(String(raw))) throw new HttpError(400, 'invalid', `${name} must be a Discord id.`);
    return String(raw);
}

const iso = d => { const t = new Date(d); return Number.isNaN(+t) ? null : t.toISOString(); };

// One batched lookup for current display names; callers fall back to the name stored on the document.
async function namesFor(guild, ids) {
    const found = new Map();
    if (!ids.length) return found;
    let members = guild.members.cache;
    try { members = await guild.members.fetch({ user: ids, time: 5000 }); } catch { /* cache only */ }
    for (const id of ids) { const m = members.get(id); if (m) found.set(id, m.displayName); }
    return found;
}

module.exports = { PAGE_SIZE, escapeRegex, parsePage, parseQ, parseSnowflake, iso, namesFor };

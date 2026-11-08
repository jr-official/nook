// features/dashboard/services/guildAccess.js
// Authoritative permission check: the bot looks the user up in the guild RIGHT NOW (briefly
// cached) and requires Manage Server (or ownership). The guild list stored in the session is
// only used to draw the server picker, never to authorise an action.
const { PermissionFlagsBits } = require('discord.js');

const cache = new Map();   // "guild:user" -> { at, ok }
const TTL = 60 * 1000;

class HttpError extends Error {
    constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}

async function requireManager(client, session, guildId) {
    if (!/^\d{15,25}$/.test(guildId)) throw new HttpError(404, 'not_found', 'Unknown server.');
    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw new HttpError(404, 'bot_not_in_guild', 'Nook is not in that server.');

    const key = `${guildId}:${session.userId}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) {
        if (!hit.ok) throw new HttpError(403, 'forbidden', 'You need the Manage Server permission there.');
        return guild;
    }
    let ok = guild.ownerId === session.userId;
    if (!ok) {
        const member = await guild.members.fetch(session.userId).catch(() => null);
        ok = !!member && member.permissions.has(PermissionFlagsBits.ManageGuild);
    }
    cache.set(key, { at: Date.now(), ok });
    if (!ok) throw new HttpError(403, 'forbidden', 'You need the Manage Server permission there.');
    return guild;
}

setInterval(() => { const now = Date.now(); for (const [k, v] of cache) if (now - v.at > TTL) cache.delete(k); }, 5 * 60 * 1000).unref?.();

module.exports = { requireManager, HttpError, _clear: () => cache.clear() };

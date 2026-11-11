// features/dashboard/api/publicApi.js
// Public, read-only leaderboard for servers whose admins switched it on in the dashboard.
// Anything missing, private or not found answers with the same 404 so servers can't be probed.
// Shows only what is already visible in the server: display name, avatar, level and XP.
const cfgL = require('../../leveling/config/levelingConfig');
const configService = require('../../leveling/services/configService');
const xpService = require('../../leveling/services/xpService');
const { levelFromXp } = require('../../leveling/utils/levelMath');
const ladder = require('../../leveling/config/ladder');
const { HttpError } = require('../services/guildAccess');

const notFound = () => new HttpError(404, 'not_found', 'This leaderboard doesn\'t exist or isn\'t public.');

const cache = new Map();                    // key -> { at, value }
const TTL_MS = 30 * 1000;
setInterval(() => { const now = Date.now(); for (const [k, v] of cache) if (now - v.at > TTL_MS) cache.delete(k); }, 60 * 1000).unref?.();

async function getLeaderboard({ client, key, query }) {
    const period = ['alltime', 'weekly', 'monthly'].includes(query.get('period')) ? query.get('period') : 'alltime';
    const page = Math.max(0, Math.min(cfgL.PUBLIC_LEADERBOARD_MAX_PAGES - 1, parseInt(query.get('page'), 10) || 0));
    const config = await configService.findPublic(key);
    if (!config) throw notFound();
    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) throw notFound();

    const ck = `${guild.id}:${period}:${page}`;
    const hit = cache.get(ck);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

    const size = cfgL.PUBLIC_LEADERBOARD_PAGE_SIZE;
    const { total, rows } = await xpService.getLeaderboardPage(guild.id, period, page, size);
    // Current display names and avatars (one batched request); fall back to what we stored.
    let members = guild.members.cache;
    if (rows.length) members = await guild.members.fetch({ user: rows.map(r => r.userId), time: 5000 }).catch(() => guild.members.cache);

    const value = {
        guild: { name: guild.name, icon: guild.iconURL({ size: 128, extension: 'png' }), memberCount: guild.memberCount },
        period, page, pageSize: size, total: Math.min(total, size * cfgL.PUBLIC_LEADERBOARD_MAX_PAGES),
        pages: Math.min(Math.ceil(total / size), cfgL.PUBLIC_LEADERBOARD_MAX_PAGES),
        rows: rows.map((r, i) => {
            const m = members.get(r.userId);
            const level = levelFromXp(r.xp, config.progression);
            return {
                rank: page * size + i + 1,
                name: (m?.displayName || r.username || 'Unknown member').slice(0, 64),
                avatar: m ? m.displayAvatarURL({ size: 64, extension: 'png' }) : null,
                xp: r.xp, level, title: ladder.titleForLevel(level)
            };
        }),
        updatedAt: new Date().toISOString()
    };
    cache.set(ck, { at: Date.now(), value });
    return value;
}

module.exports = { getLeaderboard, _clearCache: () => cache.clear() };

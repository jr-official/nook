// features/dashboard/server.js
// Tiny dependency-free HTTP API (Node's built-in http). Bearer-token auth, strict CORS,
// per-token / per-IP rate limits, 64 KB body cap, JSON errors that never leak internals.
const http = require('http');
const cfg = require('./config/dashboardConfig');
const sessionService = require('./services/sessionService');
const oauth = require('./services/discordOAuth');
const { requireManager, HttpError } = require('./services/guildAccess');
const levelingApi = require('./api/levelingApi');
const publicApi = require('./api/publicApi');
const { PermissionFlagsBits } = require('discord.js');

const MANAGE_GUILD = PermissionFlagsBits.ManageGuild;

// ── rate limiting (fixed one-minute windows, in memory) ──────────────────────
const buckets = new Map();
function limited(key, max) {
    const minute = Math.floor(Date.now() / 60000);
    const b = buckets.get(key);
    if (!b || b.minute !== minute) { buckets.set(key, { minute, n: 1 }); return false; }
    return ++b.n > max;
}
setInterval(() => { const m = Math.floor(Date.now() / 60000); for (const [k, b] of buckets) if (b.minute < m) buckets.delete(k); }, 60000).unref?.();

const ip = req => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';

function send(res, status, data, headers = {}) {
    const body = data === undefined ? '' : JSON.stringify(data);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(body);
}

async function readJson(req) {
    const chunks = []; let size = 0;
    for await (const c of req) {
        size += c.length;
        if (size > cfg.MAX_BODY_BYTES) throw new HttpError(413, 'too_large', 'Request body too large.');
        chunks.push(c);
    }
    if (!size) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new HttpError(400, 'invalid_json', 'Body must be valid JSON.'); }
}

function corsHeaders(req) {
    const origin = req.headers.origin;
    if (!origin || !cfg.ORIGINS.includes(origin)) return {};
    return {
        'Access-Control-Allow-Origin': origin, 'Vary': 'Origin',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
        'Access-Control-Max-Age': '600'
    };
}

const redirect = (res, url) => { res.writeHead(302, { Location: url, 'Cache-Control': 'no-store' }); res.end(); };
const back = (hash) => `${cfg.SITE_URL}/nook/dashboard/callback#${hash}`;

function createServer(client) {
    const ready = () => { if (!client.isReady()) throw new HttpError(503, 'starting', 'The bot is still starting up. Try again in a moment.'); };

    // Route table: [method, regex, handler, needsGuild]
    const guildRoutes = [
        ['GET',  /^\/api\/guilds\/(\d+)$/,                          levelingApi.getGuild],
        ['PUT',  /^\/api\/guilds\/(\d+)\/leveling$/,                levelingApi.putSettings],
        ['GET',  /^\/api\/guilds\/(\d+)\/leveling\/leaderboard$/,   levelingApi.getLeaderboard],
        ['GET',  /^\/api\/guilds\/(\d+)\/leveling\/members\/(\d+)$/, levelingApi.getMember],
        ['POST', /^\/api\/guilds\/(\d+)\/leveling\/xp$/,            levelingApi.postXp],
        ['POST', /^\/api\/guilds\/(\d+)\/leveling\/ladder$/,        levelingApi.postLadder]
    ];

    async function handle(req, res) {
        const url = new URL(req.url, 'http://x');
        const path = url.pathname.replace(/\/+$/, '') || '/';
        const cors = corsHeaders(req);

        if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
        if (path === '/health' || path === '/') return send(res, 200, { ok: true }, cors);

        // ── OAuth ────────────────────────────────────────────────────────────
        if (path === '/auth/login' && req.method === 'GET') {
            if (limited(`auth:${ip(req)}`, cfg.RATE.AUTH_PER_MIN)) throw new HttpError(429, 'rate_limited', 'Too many attempts.');
            ready();
            return redirect(res, oauth.authUrl(client, await sessionService.createState()));
        }
        if (path === '/auth/callback' && req.method === 'GET') {
            if (limited(`auth:${ip(req)}`, cfg.RATE.AUTH_PER_MIN)) return redirect(res, back('error=rate_limited'));
            const code = url.searchParams.get('code'), state = url.searchParams.get('state');
            if (url.searchParams.get('error')) return redirect(res, back('error=denied'));
            if (!code || !(await sessionService.consumeState(state))) return redirect(res, back('error=bad_state'));
            try {
                ready();
                const accessToken = await oauth.exchange(client, code);
                const { user, guilds } = await oauth.fetchIdentity(accessToken);
                oauth.revoke(client, accessToken);
                const mine = guilds.map(g => ({
                    id: g.id, name: g.name, icon: g.icon, owner: !!g.owner,
                    manage: !!g.owner || (BigInt(g.permissions || 0) & BigInt(MANAGE_GUILD)) !== 0n
                })).filter(g => g.manage).map(({ manage, ...g }) => g);
                const token = await sessionService.createSession(user, mine);
                return redirect(res, back(`token=${encodeURIComponent(token)}`));
            } catch (err) {
                console.error('❌ [dashboard] login failed:', err.message);
                return redirect(res, back('error=login_failed'));
            }
        }

        // ── public config ────────────────────────────────────────────────────
        if (path === '/api/config' && req.method === 'GET') {
            ready();
            const id = oauth.clientId(client);
            const invite = `https://discord.com/oauth2/authorize?client_id=${id}&scope=bot%20applications.commands&permissions=${cfg.INVITE_PERMISSIONS}`;
            return send(res, 200, { clientId: id, inviteUrl: invite }, cors);
        }

        // ── public leaderboards (opt-in per server, read-only, no login) ─────
        const pub = path.match(/^\/api\/public\/leaderboard\/([a-z0-9-]{1,40})$/);
        if (pub && req.method === 'GET') {
            if (limited(`pub:${ip(req)}`, 60)) throw new HttpError(429, 'rate_limited', 'Too many requests. Try again in a minute.');
            ready();
            return send(res, 200, await publicApi.getLeaderboard({ client, key: pub[1], query: url.searchParams }), { ...cors, 'Cache-Control': 'public, max-age=30' });
        }

        // ── everything below needs a session ────────────────────────────────
        const auth = req.headers.authorization || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
        const session = await sessionService.getSession(token);
        if (!session) throw new HttpError(401, 'unauthorized', 'Please log in again.');
        if (limited(`tok:${session.tokenHash}`, cfg.RATE.API_PER_MIN)) throw new HttpError(429, 'rate_limited', 'Slow down a little.');

        if (path === '/auth/logout' && req.method === 'POST') { await sessionService.deleteSession(token); return send(res, 200, { ok: true }, cors); }

        if (path === '/api/me' && req.method === 'GET') {
            ready();
            return send(res, 200, {
                user: { id: session.userId, username: session.username, globalName: session.globalName, avatar: session.avatar },
                guilds: session.guilds.map(g => ({ ...g, botIn: client.guilds.cache.has(g.id) })),
                expiresAt: session.expireAt
            }, cors);
        }

        for (const [method, re, fn] of guildRoutes) {
            const m = path.match(re);
            if (!m || method !== req.method) continue;
            ready();
            const guild = await requireManager(client, session, m[1]);
            const body = method === 'PUT' || method === 'POST' ? await readJson(req) : undefined;
            const result = await fn({ client, session, guild, body, query: url.searchParams, params: { userId: m[2] } });
            return send(res, 200, result, cors);
        }
        throw new HttpError(404, 'not_found', 'No such endpoint.');
    }

    return http.createServer((req, res) => {
        handle(req, res).catch(err => {
            const cors = corsHeaders(req);
            if (err instanceof HttpError) return send(res, err.status, { error: err.code, message: err.message }, cors);
            console.error('❌ [dashboard] Unhandled error:', err);
            send(res, 500, { error: 'server_error', message: 'Something went wrong.' }, cors);
        });
    });
}

module.exports = { createServer };

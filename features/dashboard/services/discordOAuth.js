// features/dashboard/services/discordOAuth.js
// Discord OAuth2 authorization-code flow (scopes: identify, guilds). The user's access token is
// used once to read their profile + server list and then revoked — it is never stored.
const cfg = require('../config/dashboardConfig');

const API = 'https://discord.com/api/v10';

const clientId = client => cfg.CLIENT_ID_ENV || client.application?.id || client.user?.id;
const redirectUri = () => `${cfg.PUBLIC_URL}/auth/callback`;

function authUrl(client, state) {
    const u = new URL('https://discord.com/oauth2/authorize');
    u.search = new URLSearchParams({
        client_id: clientId(client), response_type: 'code', redirect_uri: redirectUri(),
        scope: 'identify guilds', state, prompt: 'none'
    }).toString();
    return u.toString();
}

async function timed(url, init = {}) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    try { return await fetch(url, { ...init, signal: ctl.signal }); } finally { clearTimeout(t); }
}

async function exchange(client, code) {
    const res = await timed(`${API}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId(client), client_secret: cfg.CLIENT_SECRET, grant_type: 'authorization_code',
            code, redirect_uri: redirectUri()
        })
    });
    if (!res.ok) throw new Error(`token exchange failed (${res.status})`);
    return (await res.json()).access_token;
}

async function fetchIdentity(accessToken) {
    const headers = { Authorization: `Bearer ${accessToken}` };
    const [u, g] = await Promise.all([timed(`${API}/users/@me`, { headers }), timed(`${API}/users/@me/guilds`, { headers })]);
    if (!u.ok || !g.ok) throw new Error(`identity fetch failed (${u.status}/${g.status})`);
    return { user: await u.json(), guilds: await g.json() };
}

async function revoke(client, accessToken) {
    try {
        await timed(`${API}/oauth2/token/revoke`, {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id: clientId(client), client_secret: cfg.CLIENT_SECRET, token: accessToken, token_type_hint: 'access_token' })
        });
    } catch { /* best effort */ }
}

module.exports = { authUrl, exchange, fetchIdentity, revoke, clientId };

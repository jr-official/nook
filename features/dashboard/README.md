# Dashboard API

HTTP API behind the Nook website dashboard (`/nook/dashboard`). It runs inside the bot process
(no extra service) and is **disabled unless configured**.

## Environment variables (Railway → Variables)

| Variable | Required | Value |
|---|---|---|
| `DISCORD_CLIENT_SECRET` | yes | Developer Portal → your app → OAuth2 → Client Secret |
| `DASHBOARD_PUBLIC_URL` | yes | Public URL of the bot service, no trailing slash (Railway → Settings → Networking → Generate Domain) |
| `DASHBOARD_ORIGIN` | yes | Website origin(s) allowed to call the API, comma separated: `https://jrofficial.org,https://www.jrofficial.org` |
| `DISCORD_CLIENT_ID` | no | Defaults to the bot's application id |
| `DASHBOARD_SITE_URL` | no | Where login sends the user back to (default: first `DASHBOARD_ORIGIN`) |
| `DASHBOARD_INVITE_PERMISSIONS` | no | Permission integer for the "Add Nook" link |
| `PORT` | auto | Set by Railway |

Discord Developer Portal → OAuth2 → **Redirects**: add `<DASHBOARD_PUBLIC_URL>/auth/callback`.

## How login works

1. Website sends the browser to `GET /auth/login` → Discord authorize page (scopes `identify guilds`).
2. Discord returns to `/auth/callback?code&state`. The state is one-time and stored server-side (CSRF protection).
3. The bot exchanges the code, reads the profile + server list, **revokes the Discord token**, and stores a
   session (random token, only its hash is kept; 7-day TTL).
4. Browser is redirected to `<site>/nook/dashboard/callback#token=…` (a URL fragment, so it never reaches server logs).
   The site keeps the token and sends it as `Authorization: Bearer …`.

## Authorisation

Every `/api/guilds/:id/...` call re-checks, live, that the bot is in the server and the user has **Manage Server**
(or owns it). The server list stored in the session is only used to draw the picker.

## Endpoints

| Method | Path | |
|---|---|---|
| GET | `/health` | liveness |
| GET | `/auth/login`, `/auth/callback` | OAuth |
| POST | `/auth/logout` | end session |
| GET | `/api/config` | invite URL (public) |
| GET | `/api/me` | user + manageable servers (`botIn`) |
| GET | `/api/guilds/:id` | name, channels, roles (+ why a role can't be a reward), leveling config, presets, limits |
| PUT | `/api/guilds/:id/leveling` | partial settings update (validated with the same limits as `/level-config`) |
| GET | `/api/guilds/:id/leveling/leaderboard?period=&page=` | leaderboard |
| GET | `/api/guilds/:id/leveling/members/:userId` | one member's XP / level / rank |
| POST | `/api/guilds/:id/leveling/ladder` | create/match the 11 rank-ladder roles and add them as rewards |
| POST | `/api/guilds/:id/leveling/xp` | `{userId, mode: add|remove|set|reset, amount}` |

Limits: 120 requests/min per session, 20 auth attempts/min per IP, 64 KB request bodies, CORS restricted to
`DASHBOARD_ORIGIN`. Collections: `dashboard_sessions`, `dashboard_oauth_states` (both TTL-indexed).

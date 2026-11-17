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
| GET | `/api/guilds/:id/moderation` | `{total, warnedMembers, byDay[14], recent[25], top[5]}` of active warnings. `byDay` is the last 14 UTC days, oldest first, zeros filled. No proof links, DM flags or moderator IDs |
| GET | `/api/guilds/:id/moderation/warnings?page=1&q=&userId=` | `{total, page, pageSize:20, rows[]}`, newest first. `q` matches a case id exactly (any case), reason text, or the stored member tag (max 60 chars, always literal). `userId` filters one member. `page` 1 to 500, anything else is `400` |
| GET | `/api/guilds/:id/moderation/cases?type=&page=1&q=&userId=` | every moderation action from the cases database, newest first: `{total, page, pageSize:20, rows[{caseId,type,userId,username,moderator,reason,duration,active,expiresAt,createdAt}]}`. `type` is `all` or one of ban, softban, unban, kick, mute, unmute, warn, warn_remove (anything else is `400`). `q`, `userId` and `page` behave as for warnings |
| GET, PUT | `/api/guilds/:id/moderation/settings` | warning-point alert and decay, escalation steps and lock staff roles. `PUT` takes any of `warnAlertPoints`, `decayDays`, `escalation {enabled, tiers[{points, action, duration}]}`, `lockStaffRoles[]` and returns the same shape as `GET` (`settings`, `roles`, `locked`, `limits`) |
| GET, PUT | `/api/guilds/:id/logging` | log channels, event switches and ignored channels (see the Logging page) |
| DELETE | `/api/guilds/:id/moderation/warnings/:caseId` | removes (soft-deletes) one active warning in this server: `{ok, caseId, total}`. `404` if it doesn't exist here, even when the case id exists in another server. The remover's Discord id is stored as `removedBy` and logged |
| GET | `/api/guilds/:id/tickets` | `{stats:{open,closed,total}, byType[{type,count}], types[], recent[25]}` for this server's tickets |
| GET | `/api/guilds/:id/tickets/list?status=open\|closed\|all&type=&page=1&q=` | `{total, page, pageSize:20, rows[]}` newest first; rows have `channelId, type, userId, username, status, createdAt, closedAt, channelName` (`channelName` is null once the channel is gone). `q` matches a channel id, member id, member tag or ticket type |

Tickets can't be closed from the dashboard: the in-Discord close flow is tied to the Discord interaction (staff check, confirmation message, permission changes), so it isn't safe to call from the API.

Limits: 120 requests/min per session, 20 auth attempts/min per IP, 64 KB request bodies, CORS restricted to
`DASHBOARD_ORIGIN`. Collections: `dashboard_sessions`, `dashboard_oauth_states` (both TTL-indexed).

## Public leaderboard (opt-in)

Admins can switch on a public leaderboard for their server in the dashboard (Leaderboard tab).
The page lives on the website at `/nook/leaderboard/<link-name>` and reads:

`GET /api/public/leaderboard/:linkName?period=alltime|weekly|monthly&page=0`

- No login. Off by default; a server that is private, unknown, or one the bot isn't in all return the same `404`.
- Link names: 3 to 32 characters (letters, numbers, dashes, at least one letter), unique across servers. The server id also works while the leaderboard is public.
- Shows display name, avatar, level, XP and rank title only. User IDs are never returned.
- 25 rows per page, top 1000 only, 30 s server cache, 60 requests per minute per IP.
- Settings: `leaderboard: { public: boolean, slug: string | null }` on `PUT /api/guilds/:id/leveling`; a taken name answers `409 slug_taken`.

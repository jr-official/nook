# Nook setup

Almost everything is configured on the dashboard (jrofficial.org/nook/dashboard). Railway only holds secrets and
the few settings the bot needs before it can talk to Discord.

## Railway variables

**Required**
| Variable | What it is |
|---|---|
| `DISCORD_TOKEN` | the bot token |
| `MONGODB_URI` | the database connection string (database name `junior-bot`) |
| `DISCORD_CLIENT_SECRET` | OAuth2 client secret, for logging in to the dashboard |
| `DASHBOARD_PUBLIC_URL` | this service's public URL, e.g. `https://nook-bot.up.railway.app` |
| `DASHBOARD_ORIGIN` | the website allowed to call the API, e.g. `https://jrofficial.org` |
| `MEDIA_ALLOWED_USER_IDS` | Discord IDs allowed to use the private media library (access control, so it stays out of the website) |

**Optional**
| Variable | Default |
|---|---|
| `DISCORD_CLIENT_ID` | the bot's own application ID |
| `DASHBOARD_SITE_URL` | first `DASHBOARD_ORIGIN` |
| `DASHBOARD_INVITE_PERMISSIONS` | a ready-made permission set for the "Add to Discord" link |
| `MEDIA_MAX_FILE_MB`, `MEDIA_MAX_USER_MB`, `MEDIA_MAX_ITEMS`, `MEDIA_MAX_SHARED_MB`, `MEDIA_MAX_SHARED_ITEMS` | 8 / 40 / 100 / 150 / 300 |
| `NODE_ENV=production`, `PORT` | Railway sets these |

**Delete (no longer used or replaced by the dashboard)**
`MOD_LOGS_CHANNEL_ID`, `MEMBER_LOGS_CHANNEL_ID`, `JOINLEAVE_LOGS_CHANNEL_ID`, `MESSAGE_LOGS_CHANNEL_ID`,
`SERVER_LOGS_CHANNEL_ID`, `VOICE_LOGS_CHANNEL_ID`, `LOG_IGNORED_CHANNEL_IDS`, `LOG_EVENTS_ON`, `LOG_EVENTS_OFF`
(Logging page), `WARN_POINT_THRESHOLD`, `WARN_DECAY_DAYS` (Moderation settings page),
`LEVELING_DEFAULT_ENABLED` (Leveling page), `MEDIA_DEBUG` (debug only).

`TICKET_CHANNEL_ID`, `TICKET_CATEGORY_ID`, `TICKET_LOGS_CHANNEL_ID` have built-in defaults for the Wonders Hangout
server. Leave them unset unless the ticket channels change.

Saved dashboard settings always win. The old variables are only read as starting values, so deleting them changes
nothing once the dashboard shows the right values.

## Discord Developer Portal, Bot tab
Privileged intents that must be ON: **Server Members Intent** and **Message Content Intent**.
(Voice States and Emoji intents are not privileged and need no toggle.)

## Server permissions for the Nook role
Ban Members, Kick Members, Moderate Members, Manage Messages, Read Message History, **View Audit Log**,
and for `/lock`, `/lockdown`: **Manage Channels** and **Manage Roles**.
Nook's role must sit above the members it moderates. In each log channel Nook needs View Channel, Send Messages,
Embed Links and Attach Files.

## Dashboard pages
- **Logging**: log channels, event switches, ignored channels.
- **Moderation → Settings**: warning-point alert and decay, automatic escalation steps, staff roles that can still
  talk in locked channels, and the list of locked channels.

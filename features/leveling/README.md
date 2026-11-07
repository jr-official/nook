# Leveling

Server-only XP system: members earn XP for chatting, level up, unlock role rewards and climb
all-time / weekly / monthly leaderboards. Everything is configured per server with `/level-config`.

## Commands

| Command | Who | What |
|---|---|---|
| `/rank [member]` | everyone | Rank card image (avatar, level, XP bar, server rank) |
| `/level progress [member]` | everyone | Level + XP progress embed (private to you) |
| `/level rewards` | everyone | Role rewards and which ones you've unlocked |
| `/leaderboard [period]` | everyone | Paginated leaderboard: all-time, weekly or monthly (buttons + dropdown) |
| `/level-config` | Manage Server | Interactive settings panel (see below) |

> The spec's `/level` and `/level rewards` can't both exist in Discord (a command with
> subcommands cannot also run on its own), so they are `/level progress` and `/level rewards`.

## How XP works

* A normal text message earns a random **15–25 XP**, at most once per **60 s** per member per server
  (both configurable). Applies to text channels, announcement channels, threads and voice-channel chat.
* No XP for: bots, webhooks, DMs, empty or attachment-only messages, system messages, messages that
  start with `!` (bot commands), edits, ignored channels/roles, or leveling disabled.
* Anti-spam: text must have ≥3 characters after removing links/mentions/custom emoji and ≥3 distinct
  characters; repeating one of your last 5 messages (10-minute window) earns nothing.
* Level maths: XP needed to go from level *n* to *n+1* is `a·n² + b·n + c` (default `5n² + 50n + 100`).
  Levels are always derived from total XP. Presets: Classic, Easy, Hard, or custom `a`, `b`, `c`.

## /level-config sections

* **General** – enable/disable, XP range, cooldown, progression preset or custom formula.
* **Announcements** – on/off, channel (default: where the member chatted), message text with
  `{user} {username} {level} {xp} {server}`. Only the member is ever pinged.
* **Ignored** – channels (threads inherit) and roles that earn no XP.
* **Role rewards** – pick a role → enter the level. *Stack* keeps every role; *Replace* keeps only the newest milestone.
* **Manual XP** – add / remove / set a member's XP, or reset them (type RESET).

## Discord permissions

* **Manage Roles**, with the bot's role **above** every reward role (rewards are skipped otherwise; the
  panel shows ⚠️ next to roles the bot can't give).
* **View Channel + Send Messages** in the announcement channel(s).
* Intents already enabled in `main.js`: Guilds, GuildMessages, **MessageContent**, GuildMembers.
* No new environment variables are required. Optional: `LEVELING_DEFAULT_ENABLED=false` makes leveling
  opt-in (servers must switch it on in `/level-config`).

## Data (MongoDB, database `junior-bot`)

| Collection | Contents | Indexes |
|---|---|---|
| `level_config` | one settings document per server | `guildId` (unique) |
| `level_members` | `guildId, userId, xp, level, messages, lastXpAt, username` | `(guildId,userId)` unique; `(guildId,xp↓,userId)` |
| `level_periods` | weekly / monthly XP per member (`period`, `key` like `2026-W45` / `2026-11`) | unique `(guildId,userId,period,key)`; `(guildId,period,key,xp↓,userId)`; TTL on `expireAt` (100 days) |

* Cooldown is enforced inside one atomic `findOneAndUpdate`, so simultaneous messages (or two bot
  instances) can never double-pay. Level-ups are claimed with a conditional update, so each is announced once.
* Weekly boards reset Monday 00:00 UTC, monthly on the 1st (UTC) — by switching the period key; lifetime XP is never touched.
* Message **text is never stored** — only counters and the member's display name (for the leaderboard).

## Files

```
leveling.js                 entry point: command definitions, event wiring
config/levelingConfig.js    defaults, limits, presets
utils/levelMath.js          progression formula (closed form + binary search)
utils/antiSpam.js           content filter, duplicate & cooldown guards
utils/format.js             number formatting, templates, week/month keys
services/configService.js   per-guild settings (cached)
services/xpService.js       atomic XP, ranks, leaderboards, manual adjustments
services/rewardService.js   level → role rewards
handlers/messageHandler.js  MessageCreate → XP → level-up → announcement
handlers/commandHandler.js  /rank /level /leaderboard
handlers/configPanel.js     /level-config panel
ui/rankCard.js              rank card PNG (@napi-rs/canvas)
assets/                     bundled Inter font subset (SIL OFL)
```

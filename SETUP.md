# Nook setup checklist

## Railway variables
| Variable | Needed for | Notes |
|---|---|---|
| `DISCORD_TOKEN`, `MONGODB_URI` | the bot | already set |
| `MOD_LOGS_CHANNEL_ID` | moderation log | cases, warns, purges, threshold alerts |
| `MEMBER_LOGS_CHANNEL_ID` | member log | joins, leaves, nickname and role changes. Falls back to a channel named like `member-logs` |
| `MESSAGE_LOGS_CHANNEL_ID` | message log | deleted, edited and bulk-deleted messages. Falls back to a channel named like `message-logs` |
| `WARN_POINT_THRESHOLD` | weighted warns | default `5`; `0` turns the staff alert off |
| `WARN_DECAY_DAYS` | weighted warns | default `0` (warnings never lose points) |

## Discord Developer Portal, Bot tab
Privileged Gateway Intents that must be ON: **Server Members Intent** and **Message Content Intent**.

## Server permissions for the Nook role
Ban Members, Kick Members, Moderate Members, Manage Messages, Read Message History, and **View Audit Log**
(without it, bans/kicks/timeouts done by hand are still recorded, but the moderator shows as unknown).
Nook's role must sit above the members it moderates. Give it View Channel and Send Messages (plus Embed Links
and Attach Files) in each log channel.

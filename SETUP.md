# Nook setup checklist

## Railway variables
| Variable | Needed for | Notes |
|---|---|---|
| `DISCORD_TOKEN`, `MONGODB_URI` | the bot | already set |
| `MOD_LOGS_CHANNEL_ID` | moderation log | cases, warns, purges, threshold alerts |
| `MEMBER_LOGS_CHANNEL_ID` | member log | nickname, name, avatar and role changes. Falls back to a channel named like `member-logs`, then the mod log |
| `JOINLEAVE_LOGS_CHANNEL_ID` | join/leave log | joins and leaves. Falls back to a channel named like `fluctuation-logs` / `join-leave`, then the member log |
| `MESSAGE_LOGS_CHANNEL_ID` | message log | deleted, edited and bulk-deleted messages. Falls back to a channel named like `message-logs`, then the mod log |
| `SERVER_LOGS_CHANNEL_ID` | server log | channels, threads, roles, emoji, server settings. Falls back to the mod log |
| `VOICE_LOGS_CHANNEL_ID` | voice log | join / move / leave voice. Falls back to the member log |
| `LOG_IGNORED_CHANNEL_IDS` | all logs | comma-separated channel or category IDs that are never logged (messages, voice, threads) |
| `LOG_EVENTS_OFF` / `LOG_EVENTS_ON` | all logs | comma-separated event names to switch off / on (see below) |
| `WARN_POINT_THRESHOLD` | weighted warns | default `5`; `0` turns the staff alert off |
| `WARN_DECAY_DAYS` | weighted warns | default `0` (warnings never lose points) |

## Discord Developer Portal, Bot tab
Privileged Gateway Intents that must be ON: **Server Members Intent** and **Message Content Intent**.

## Server permissions for the Nook role
Ban Members, Kick Members, Moderate Members, Manage Messages, Read Message History, and **View Audit Log**
(without it, bans/kicks/timeouts done by hand are still recorded, but the moderator shows as unknown).
Nook's role must sit above the members it moderates. Give it View Channel and Send Messages (plus Embed Links
and Attach Files) in each log channel.

## Log events
On by default: `msg_delete msg_edit msg_purge member_join member_leave role_change name_change channel_create
channel_update channel_delete role_create role_update role_delete server_update emoji_change voice_join voice_move voice_leave`.
Off by default (noisy): `thread_create thread_update thread_delete avatar_change`.
Bans, unbans, kicks and timeouts always go to the mod log as cases and have no switch.

## Intents
Gateway intents the bot asks for (Developer Portal toggles only exist for the privileged ones):
Server Members and Message Content (privileged, must be ON); Guild Voice States and Emojis (not privileged).

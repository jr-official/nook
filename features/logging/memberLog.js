// features/logging/memberLog.js — joins, leaves, nickname/role changes, and moderation done outside Nook.
const { Events, EmbedBuilder } = require('discord.js');
const { send, eventOn } = require('./config');
const { findAudit, alreadyHandled, AuditLogEvent } = require('./auditService');
const { logModeration } = require('../moderation/utils/moderationUtils');

const NO_PING = { parse: [] };
const ts = (ms, f = 'R') => `<t:${Math.floor(ms / 1000)}:${f}>`;
const UNKNOWN_MOD = { id: null, tag: 'Unknown (Nook can’t read the audit log)' };
const cut = (s, n = 1000) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const human = ms => { const m = Math.round(ms / 60000); if (m < 60) return `${m}m`; const h = Math.round(m / 60); return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`; };

function register(client) {
    const post = (guild, embed, kind = 'member') => send(guild, kind, embed);

    // Global username / display name / avatar per user. Discord hands the bot the already-updated
    // user object, so changes are found by comparing against what we saw last.
    const ident = new Map();
    const snap = u => ({ username: u.username ?? u.tag, globalName: u.globalName ?? null, avatar: u.avatar ?? null });
    const remember = m => { if (m?.user) ident.set(m.user.id, snap(m.user)); };
    client.once(Events.ClientReady, () => { for (const g of client.guilds.cache.values()) for (const m of g.members.cache.values()) remember(m); });

    client.on(Events.GuildMemberAdd, async m => {
        try {
            remember(m);
            if (!eventOn('member_join')) return;
            const age = Date.now() - m.user.createdTimestamp;
            const e = new EmbedBuilder().setColor('#43b581').setTitle('📥 Member joined').setThumbnail(m.user.displayAvatarURL?.({ size: 128 }) ?? null).setTimestamp()
                .setDescription(`${m.user.tag} (${m.user.id})`)
                .addFields({ name: 'Account created', value: `${ts(m.user.createdTimestamp)}${age < 7 * 86400000 ? ' ⚠️ new account' : ''}`, inline: true },
                    { name: 'Members', value: `${m.guild.memberCount}`, inline: true });
            await post(m.guild, e, 'joinleave');
        } catch (err) { console.error('[logging] memberAdd:', err.message); }
    });

    client.on(Events.GuildMemberRemove, async m => {
        try {
            const user = m.user; if (!user) return;
            // Was it a kick done outside Nook?
            const entry = await findAudit(m.guild, AuditLogEvent.MemberKick, user.id);
            if (entry && !(await alreadyHandled(client, m.guild, entry, user.id, 'kick'))) {
                await logModeration(m.guild, { type: 'kick', target: user, moderator: entry.executor ?? UNKNOWN_MOD, reason: entry.reason || 'No reason given (kicked outside Nook)' });
                return;
            }
            if (entry) return;     // kicked by Nook: already in the mod log
            ident.delete(user.id);
            if (!eventOn('member_leave')) return;
            const roles = m.roles?.cache ? [...m.roles.cache.values()].filter(r => r.id !== m.guild.id).map(r => r.name) : [];
            const e = new EmbedBuilder().setColor('#a0a0a8').setTitle('📤 Member left').setTimestamp().setDescription(`${user.tag} (${user.id})`)
                .addFields({ name: 'Joined', value: m.joinedTimestamp ? ts(m.joinedTimestamp) : 'Unknown', inline: true },
                    { name: 'Members', value: `${m.guild.memberCount}`, inline: true });
            if (roles.length) e.addFields({ name: 'Roles', value: cut(roles.join(', ')) });
            await post(m.guild, e, 'joinleave');
        } catch (err) { console.error('[logging] memberRemove:', err.message); }
    });

    client.on(Events.GuildMemberUpdate, async (before, after) => {
        try {
            if (before.partial) return;
            const who = `${after.user.tag} (${after.user.id})`;
            const now0 = snap(after.user), was0 = ident.get(after.user.id); remember(after);
            if (was0 && eventOn('name_change') && (was0.username !== now0.username || was0.globalName !== now0.globalName)) {
                await post(after.guild, new EmbedBuilder().setColor('#5865f2').setTitle('📝 Name changed').setDescription(who).setTimestamp()
                    .addFields({ name: 'Before', value: `${was0.globalName ?? '*none*'} (@${was0.username})`, inline: true }, { name: 'After', value: `${now0.globalName ?? '*none*'} (@${now0.username})`, inline: true }));
            }
            if (was0 && eventOn('avatar_change') && was0.avatar !== now0.avatar) {
                await post(after.guild, new EmbedBuilder().setColor('#5865f2').setTitle('🖼️ Avatar changed').setDescription(who).setTimestamp().setThumbnail(after.user.displayAvatarURL?.({ size: 256 }) ?? null));
            }
            if (before.nickname !== after.nickname && eventOn('name_change')) {
                await post(after.guild, new EmbedBuilder().setColor('#5865f2').setTitle('🏷️ Nickname changed').setDescription(who).setTimestamp()
                    .addFields({ name: 'Before', value: before.nickname ?? '*none*', inline: true }, { name: 'After', value: after.nickname ?? '*none*', inline: true }));
            }
            const added = [...after.roles.cache.values()].filter(r => !before.roles.cache.has(r.id));
            const removed = [...before.roles.cache.values()].filter(r => !after.roles.cache.has(r.id));
            if ((added.length || removed.length) && eventOn('role_change')) {
                const e = new EmbedBuilder().setColor('#5865f2').setTitle('🎭 Roles changed').setDescription(who).setTimestamp();
                if (added.length) e.addFields({ name: 'Added', value: cut(added.map(r => r.name).join(', ')), inline: true });
                if (removed.length) e.addFields({ name: 'Removed', value: cut(removed.map(r => r.name).join(', ')), inline: true });
                await post(after.guild, e);
            }
            // Timeout set or cleared outside Nook -> recorded as a mute / unmute case.
            const was = before.communicationDisabledUntilTimestamp, now = after.communicationDisabledUntilTimestamp;
            if ((was ?? 0) !== (now ?? 0)) {
                const setting = now && now > Date.now();
                if (!setting && !(was && was > Date.now())) return;       // an old timeout simply lapsing
                const type = setting ? 'mute' : 'unmute';
                const entry = await findAudit(after.guild, AuditLogEvent.MemberUpdate, after.user.id);
                if (await alreadyHandled(client, after.guild, entry, after.user.id, type)) return;
                await logModeration(after.guild, {
                    type, target: after.user, moderator: entry?.executor ?? UNKNOWN_MOD,
                    reason: entry?.reason || `No reason given (${type === 'mute' ? 'timed out' : 'timeout removed'} outside Nook)`,
                    ...(setting ? { duration: human(now - Date.now()), expiresAt: new Date(now) } : {})
                });
            }
        } catch (err) { console.error('[logging] memberUpdate:', err.message); }
    });

    client.on(Events.GuildBanAdd, async ban => {
        try {
            const entry = await findAudit(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
            if (await alreadyHandled(client, ban.guild, entry, ban.user.id, 'ban')) return;
            await logModeration(ban.guild, { type: 'ban', target: ban.user, moderator: entry?.executor ?? UNKNOWN_MOD, reason: entry?.reason || ban.reason || 'No reason given (banned outside Nook)' });
        } catch (err) { console.error('[logging] banAdd:', err.message); }
    });

    client.on(Events.GuildBanRemove, async ban => {
        try {
            const entry = await findAudit(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);
            if (await alreadyHandled(client, ban.guild, entry, ban.user.id, 'unban')) return;
            await logModeration(ban.guild, { type: 'unban', target: ban.user, moderator: entry?.executor ?? UNKNOWN_MOD, reason: entry?.reason || 'No reason given (unbanned outside Nook)' });
        } catch (err) { console.error('[logging] banRemove:', err.message); }
    });
}

module.exports = { register };

// features/logging/serverLog.js — channels, threads, roles, emoji and server settings (server log channel).
const { Events, EmbedBuilder, PermissionsBitField } = require('discord.js');
const { send, eventOn, isIgnored } = require('./config');
const { findAudit, AuditLogEvent } = require('./auditService');

const cut = (s, n = 1000) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const by = e => (e?.executor ? `${e.executor.tag ?? e.executor.username} (${e.executor.id})` : null);
const TYPE = { 0: 'Text', 2: 'Voice', 4: 'Category', 5: 'Announcement', 13: 'Stage', 15: 'Forum', 16: 'Media' };
const kind = c => TYPE[c.type] ?? 'Channel';

function permNames(before, after) {
    const b = new PermissionsBitField(before), a = new PermissionsBitField(after);
    return { added: a.remove(b).toArray(), removed: new PermissionsBitField(before).remove(new PermissionsBitField(after)).toArray() };
}

function register(client) {
    const embed = (color, title, desc) => new EmbedBuilder().setColor(color).setTitle(title).setDescription(desc).setTimestamp();
    const withBy = (e, entry) => { const w = by(entry); if (w) e.addFields({ name: 'By', value: w, inline: true }); return e; };
    const safe = (name, fn) => async (...a) => { try { await fn(...a); } catch (err) { console.error(`[logging] ${name}:`, err.message); } };

    client.on(Events.ChannelCreate, safe('channelCreate', async ch => {
        if (!ch.guild || !eventOn('channel_create')) return;
        const entry = await findAudit(ch.guild, AuditLogEvent.ChannelCreate, ch.id);
        await send(ch.guild, 'server', withBy(embed('#43b581', '➕ Channel created', `${kind(ch)} channel **${cut(ch.name)}** (<#${ch.id}>)`), entry));
    }));
    client.on(Events.ChannelDelete, safe('channelDelete', async ch => {
        if (!ch.guild || !eventOn('channel_delete')) return;
        const entry = await findAudit(ch.guild, AuditLogEvent.ChannelDelete, ch.id);
        await send(ch.guild, 'server', withBy(embed('#ff5555', '➖ Channel deleted', `${kind(ch)} channel **${cut(ch.name)}** (${ch.id})`), entry));
    }));
    client.on(Events.ChannelUpdate, safe('channelUpdate', async (a, b) => {
        if (!b.guild || !eventOn('channel_update')) return;
        const diffs = [];
        if (a.name !== b.name) diffs.push(`Name: **${cut(a.name)}** → **${cut(b.name)}**`);
        if (a.topic !== b.topic) diffs.push(`Topic: ${cut(a.topic ?? 'none', 200)} → ${cut(b.topic ?? 'none', 200)}`);
        if (a.nsfw !== b.nsfw) diffs.push(`Age-restricted: ${!!a.nsfw} → ${!!b.nsfw}`);
        if (a.rateLimitPerUser !== b.rateLimitPerUser) diffs.push(`Slowmode: ${a.rateLimitPerUser ?? 0}s → ${b.rateLimitPerUser ?? 0}s`);
        if (a.parentId !== b.parentId) diffs.push(`Category: ${a.parent?.name ?? 'none'} → ${b.parent?.name ?? 'none'}`);
        const ow = ch => ch.permissionOverwrites?.cache ? JSON.stringify([...ch.permissionOverwrites.cache.values()].map(o => [o.id, String(o.allow.bitfield), String(o.deny.bitfield)]).sort()) : '';
        if (ow(a) !== ow(b)) diffs.push('Permission overwrites changed');
        if (!diffs.length) return;
        const entry = await findAudit(b.guild, AuditLogEvent.ChannelUpdate, b.id);
        await send(b.guild, 'server', withBy(embed('#f0b232', '✏️ Channel updated', `<#${b.id}>\n${diffs.join('\n')}`), entry));
    }));

    client.on(Events.ThreadCreate, safe('threadCreate', async (t, isNew) => {
        if (!t.guild || !isNew || !eventOn('thread_create') || isIgnored(t.parentId)) return;
        await send(t.guild, 'server', embed('#43b581', '🧵 Thread created', `**${cut(t.name)}** (<#${t.id}>) in <#${t.parentId}>`));
    }));
    client.on(Events.ThreadUpdate, safe('threadUpdate', async (a, b) => {
        if (!b.guild || !eventOn('thread_update') || isIgnored(b.parentId)) return;
        const d = [];
        if (a.name !== b.name) d.push(`Name: **${cut(a.name)}** → **${cut(b.name)}**`);
        if (a.archived !== b.archived) d.push(b.archived ? 'Archived' : 'Unarchived');
        if (a.locked !== b.locked) d.push(b.locked ? 'Locked' : 'Unlocked');
        if (d.length) await send(b.guild, 'server', embed('#f0b232', '🧵 Thread updated', `<#${b.id}>\n${d.join('\n')}`));
    }));
    client.on(Events.ThreadDelete, safe('threadDelete', async t => {
        if (!t.guild || !eventOn('thread_delete') || isIgnored(t.parentId)) return;
        await send(t.guild, 'server', embed('#ff5555', '🧵 Thread deleted', `**${cut(t.name)}** (${t.id})`));
    }));

    client.on(Events.GuildRoleCreate, safe('roleCreate', async r => {
        if (!eventOn('role_create')) return;
        const entry = await findAudit(r.guild, AuditLogEvent.RoleCreate, r.id);
        await send(r.guild, 'server', withBy(embed('#43b581', '➕ Role created', `**${cut(r.name)}** (${r.id})`), entry));
    }));
    client.on(Events.GuildRoleDelete, safe('roleDelete', async r => {
        if (!eventOn('role_delete')) return;
        const entry = await findAudit(r.guild, AuditLogEvent.RoleDelete, r.id);
        await send(r.guild, 'server', withBy(embed('#ff5555', '➖ Role deleted', `**${cut(r.name)}** (${r.id})`), entry));
    }));
    client.on(Events.GuildRoleUpdate, safe('roleUpdate', async (a, b) => {
        if (!eventOn('role_update')) return;
        const d = [];
        if (a.name !== b.name) d.push(`Name: **${cut(a.name)}** → **${cut(b.name)}**`);
        if (a.color !== b.color) d.push(`Colour: #${a.color.toString(16).padStart(6, '0')} → #${b.color.toString(16).padStart(6, '0')}`);
        if (a.hoist !== b.hoist) d.push(`Shown separately: ${a.hoist} → ${b.hoist}`);
        if (a.mentionable !== b.mentionable) d.push(`Mentionable: ${a.mentionable} → ${b.mentionable}`);
        const { added, removed } = permNames(a.permissions.bitfield, b.permissions.bitfield);
        if (added.length) d.push(`Permissions added: ${cut(added.join(', '), 300)}`);
        if (removed.length) d.push(`Permissions removed: ${cut(removed.join(', '), 300)}`);
        if (!d.length) return;
        const entry = await findAudit(b.guild, AuditLogEvent.RoleUpdate, b.id);
        await send(b.guild, 'server', withBy(embed('#f0b232', '✏️ Role updated', `<@&${b.id}> (${cut(b.name)})\n${d.join('\n')}`), entry));
    }));

    client.on(Events.GuildUpdate, safe('guildUpdate', async (a, b) => {
        if (!eventOn('server_update')) return;
        const d = [];
        if (a.name !== b.name) d.push(`Name: **${cut(a.name)}** → **${cut(b.name)}**`);
        if (a.icon !== b.icon) d.push('Icon changed');
        if (a.banner !== b.banner) d.push('Banner changed');
        if (a.ownerId !== b.ownerId) d.push(`Owner: <@${a.ownerId}> → <@${b.ownerId}>`);
        if (a.verificationLevel !== b.verificationLevel) d.push(`Verification level: ${a.verificationLevel} → ${b.verificationLevel}`);
        if (a.afkChannelId !== b.afkChannelId) d.push(`AFK channel: ${a.afkChannelId ? `<#${a.afkChannelId}>` : 'none'} → ${b.afkChannelId ? `<#${b.afkChannelId}>` : 'none'}`);
        if (a.systemChannelId !== b.systemChannelId) d.push(`System messages channel: ${a.systemChannelId ? `<#${a.systemChannelId}>` : 'none'} → ${b.systemChannelId ? `<#${b.systemChannelId}>` : 'none'}`);
        if (!d.length) return;
        const entry = await findAudit(b, AuditLogEvent.GuildUpdate, b.id);
        await send(b, 'server', withBy(embed('#f0b232', '⚙️ Server updated', d.join('\n')), entry));
    }));

    client.on(Events.GuildEmojiCreate, safe('emojiCreate', async e => { if (eventOn('emoji_change')) await send(e.guild, 'server', embed('#43b581', '😀 Emoji added', `**:${e.name}:** (${e.id})`)); }));
    client.on(Events.GuildEmojiDelete, safe('emojiDelete', async e => { if (eventOn('emoji_change')) await send(e.guild, 'server', embed('#ff5555', '😀 Emoji removed', `**:${e.name}:** (${e.id})`)); }));
    client.on(Events.GuildEmojiUpdate, safe('emojiUpdate', async (a, b) => { if (eventOn('emoji_change') && a.name !== b.name) await send(b.guild, 'server', embed('#f0b232', '😀 Emoji renamed', `:${a.name}: → :${b.name}:`)); }));
}

module.exports = { register };

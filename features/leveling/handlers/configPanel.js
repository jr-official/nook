// features/leveling/handlers/configPanel.js
// Interactive /level-config panel. Ephemeral, so only the admin who opened it sees it;
// permissions are re-checked on every click anyway. customId layout: lvl:cfg:<action>[:<arg>]
const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
    ChannelSelectMenuBuilder, RoleSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
    ChannelType, PermissionFlagsBits, MessageFlags
} = require('discord.js');
const cfg = require('../config/levelingConfig');
const configService = require('../services/configService');
const xpService = require('../services/xpService');
const rewardService = require('../services/rewardService');
const { totalXpForLevel, validateProgression } = require('../utils/levelMath');
const { fmt } = require('../utils/format');

const { LIMITS } = cfg;
const AMBER = 0xffd28a;
const EPHEMERAL = MessageFlags.Ephemeral;
const SECTIONS = {
    general:  { label: 'General',          emoji: '⚙️', desc: 'Enable, XP range, cooldown, progression' },
    announce: { label: 'Announcements',    emoji: '📣', desc: 'Level-up channel and message' },
    ignored:  { label: 'Ignored',          emoji: '🚫', desc: 'Channels and roles that earn no XP' },
    rewards:  { label: 'Role rewards',     emoji: '🏅', desc: 'Roles granted at level milestones' },
    tools:    { label: 'Manual XP',        emoji: '🛠️', desc: 'Add, remove, set or reset a member\'s XP' }
};
const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const IGNORABLE_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildForum];

const formula = p => `${p.a}·n² + ${p.b}·n + ${p.c}`;
const row = (...c) => new ActionRowBuilder().addComponents(...c);
const btn = (id, label, style = ButtonStyle.Secondary, emoji) => {
    const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
    if (emoji) b.setEmoji(emoji);
    return b;
};

function isAdmin(interaction) {
    return !!interaction.guild && !!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

// ── Rendering ────────────────────────────────────────────────────────────────
function navRow(section) {
    return row(new StringSelectMenuBuilder().setCustomId('lvl:cfg:nav').setPlaceholder('Choose a section')
        .addOptions(Object.entries(SECTIONS).map(([value, s]) => ({ label: s.label, description: s.desc, value, emoji: s.emoji, default: value === section }))));
}

function sample(p) {
    return [1, 5, 10, 25, 50].map(l => `Lv ${l}: ${fmt(totalXpForLevel(l, p))}`).join(' · ');
}

function render(section, c, guild) {
    const e = new EmbedBuilder().setColor(AMBER).setTitle(`${SECTIONS[section].emoji} Leveling — ${SECTIONS[section].label}`);
    const comps = [navRow(section)];

    if (section === 'general') {
        e.setDescription('Changes apply instantly.')
            .addFields(
                { name: 'Status', value: c.enabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
                { name: 'XP per message', value: `${c.xpMin}–${c.xpMax}`, inline: true },
                { name: 'Cooldown', value: `${c.cooldownSec}s per member`, inline: true },
                { name: 'XP needed per level', value: `\`${formula(c.progression)}\` (n = current level)\n${sample(c.progression)} total XP` }
            );
        comps.push(row(
            btn('lvl:cfg:toggle', c.enabled ? 'Disable leveling' : 'Enable leveling', c.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
            btn('lvl:cfg:xpmodal', 'XP & cooldown', ButtonStyle.Primary, '🎲'),
            btn('lvl:cfg:progmodal', 'Custom progression', ButtonStyle.Primary, '📈')
        ));
        const active = Object.entries(cfg.PRESETS).find(([, p]) => p.a === c.progression.a && p.b === c.progression.b && p.c === c.progression.c)?.[0];
        comps.push(row(new StringSelectMenuBuilder().setCustomId('lvl:cfg:preset').setPlaceholder('Progression preset')
            .addOptions(Object.entries(cfg.PRESETS).map(([value, p]) => ({ label: p.label, description: `${formula(p)}`, value, default: value === active })))));
    }

    if (section === 'announce') {
        const ch = c.announce.channelId ? (guild.channels.cache.has(c.announce.channelId) ? `<#${c.announce.channelId}>` : '⚠️ deleted channel (using message channel)') : 'The channel the member was chatting in';
        e.addFields(
            { name: 'Announcements', value: c.announce.enabled ? '🟢 On' : '🔴 Off', inline: true },
            { name: 'Channel', value: ch, inline: true },
            { name: 'Message', value: `\`\`\`${c.announce.message.replace(/`/g, "'")}\`\`\`\nPlaceholders: \`{user}\` \`{username}\` \`{level}\` \`{title}\` \`{xp}\` \`{server}\`` }
        ).setFooter({ text: 'When a level-up unlocks a role reward, the bot adds a line about it. Off = no messages at all.' });
        comps.push(row(
            btn('lvl:cfg:atoggle', c.announce.enabled ? 'Turn off' : 'Turn on', c.announce.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
            btn('lvl:cfg:amsg', 'Edit message', ButtonStyle.Primary, '✏️'),
            btn('lvl:cfg:aclear', 'Use message channel', ButtonStyle.Secondary, '↩️').setDisabled(!c.announce.channelId)
        ));
        const sel = new ChannelSelectMenuBuilder().setCustomId('lvl:cfg:achan').setPlaceholder('Pick the announcement channel')
            .setChannelTypes(TEXT_CHANNELS).setMinValues(1).setMaxValues(1);
        comps.push(row(sel));
    }

    if (section === 'ignored') {
        e.setDescription('Messages in ignored channels (and their threads) or from members with an ignored role earn no XP. Selecting nothing clears the list.')
            .addFields(
                { name: `Channels (${c.ignoredChannels.length})`, value: c.ignoredChannels.map(i => `<#${i}>`).join(' ') || 'None' },
                { name: `Roles (${c.ignoredRoles.length})`, value: c.ignoredRoles.map(i => `<@&${i}>`).join(' ') || 'None' }
            );
        const chSel = new ChannelSelectMenuBuilder().setCustomId('lvl:cfg:ichan').setPlaceholder('Ignored channels')
            .setChannelTypes(IGNORABLE_CHANNELS).setMinValues(0).setMaxValues(LIMITS.MAX_IGNORED);
        const live = c.ignoredChannels.filter(i => guild.channels.cache.has(i));
        if (live.length) chSel.setDefaultChannels(live);
        const roleSel = new RoleSelectMenuBuilder().setCustomId('lvl:cfg:irole').setPlaceholder('Ignored roles')
            .setMinValues(0).setMaxValues(LIMITS.MAX_IGNORED);
        const liveRoles = c.ignoredRoles.filter(i => guild.roles.cache.has(i));
        if (liveRoles.length) roleSel.setDefaultRoles(liveRoles);
        comps.push(row(chSel), row(roleSel));
    }

    if (section === 'rewards') {
        const list = [...c.rewards].sort((a, b) => a.level - b.level);
        e.setDescription(list.length
            ? list.map(r => {
                const prob = rewardService.roleProblem(guild, guild.roles.cache.get(r.roleId));
                return `**Level ${r.level}** — <@&${r.roleId}>${prob ? ` ⚠️ ${prob}` : ''}`;
            }).join('\n')
            : 'No rewards yet. Pick a role below, then enter the level it unlocks.')
            .addFields({ name: 'Mode', value: c.rewardMode === 'replace' ? '**Replace** — only the newest milestone role is kept' : '**Stack** — members keep every role they unlock' })
            .setFooter({ text: `${list.length}/${LIMITS.MAX_REWARDS} rewards · The bot\'s role must sit ABOVE reward roles and have Manage Roles.` });
        comps.push(row(btn('lvl:cfg:rmode', c.rewardMode === 'replace' ? 'Switch to stacking' : 'Switch to replacing', ButtonStyle.Secondary, '🔁')));
        comps.push(row(new RoleSelectMenuBuilder().setCustomId('lvl:cfg:radd').setPlaceholder('Add or change a reward — pick a role').setMinValues(1).setMaxValues(1)));
        if (list.length) {
            comps.push(row(new StringSelectMenuBuilder().setCustomId('lvl:cfg:rdel').setPlaceholder('Remove a reward')
                .addOptions(list.slice(0, 25).map(r => ({
                    label: `Level ${r.level} — ${(guild.roles.cache.get(r.roleId)?.name || 'deleted role').slice(0, 80)}`,
                    value: r.roleId
                })))));
        }
    }

    if (section === 'tools') {
        e.setDescription('Adjust a member\'s **lifetime** XP. Their level and reward roles are updated to match; no announcement is posted. Adding XP also counts toward weekly/monthly boards.')
            .addFields({ name: 'You will be asked for', value: 'The member\'s ID or @mention, plus an amount (not needed for reset).' });
        comps.push(row(
            btn('lvl:cfg:t:add', 'Add XP', ButtonStyle.Success, '➕'),
            btn('lvl:cfg:t:remove', 'Remove XP', ButtonStyle.Secondary, '➖'),
            btn('lvl:cfg:t:set', 'Set XP', ButtonStyle.Primary, '🎯'),
            btn('lvl:cfg:t:reset', 'Reset member', ButtonStyle.Danger, '🗑️')
        ));
    }
    return { embeds: [e], components: comps, allowedMentions: { parse: [] } };
}

async function open(interaction, section = 'general') {
    if (!isAdmin(interaction)) return interaction.reply({ content: '❌ You need the **Manage Server** permission.', flags: EPHEMERAL });
    const c = await configService.get(interaction.guildId);
    await interaction.reply({ ...render(section, c, interaction.guild), flags: EPHEMERAL });
}

// ── Modals ───────────────────────────────────────────────────────────────────
const input = (id, label, { value, placeholder, style = TextInputStyle.Short, max = 20, required = true } = {}) => {
    const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(max);
    if (value !== undefined) t.setValue(String(value).slice(0, max));
    if (placeholder) t.setPlaceholder(placeholder);
    return row(t);
};
const modal = (id, title, ...rows) => new ModalBuilder().setCustomId(id).setTitle(title).addComponents(...rows);

const TOOL_TITLES = { add: 'Add XP', remove: 'Remove XP', set: 'Set XP', reset: 'Reset member' };

function parseIntStrict(raw, min, max) {
    const t = String(raw).trim().replace(/,/g, '');
    if (!/^-?\d+$/.test(t)) return null;
    const n = Number(t);
    return n >= min && n <= max ? n : null;
}
function parseNum(raw, min, max) {
    const t = String(raw).trim();
    if (!/^\d+(\.\d+)?$/.test(t)) return null;
    const n = Number(t);
    return n >= min && n <= max ? n : null;
}
const parseUserId = raw => (String(raw).match(/\d{15,25}/) || [null])[0];

// ── Component dispatch ───────────────────────────────────────────────────────
async function handleComponent(interaction) {
    if (!isAdmin(interaction)) return interaction.reply({ content: '❌ You need the **Manage Server** permission.', flags: EPHEMERAL });
    const [, , action, arg] = interaction.customId.split(':');
    const guildId = interaction.guildId;
    const c = await configService.get(guildId);
    const show = async (section, cfgNow = c) => interaction.update(render(section, cfgNow, interaction.guild));

    switch (action) {
        case 'nav': return show(SECTIONS[interaction.values[0]] ? interaction.values[0] : 'general');

        // general
        case 'toggle':   return show('general', await configService.update(guildId, { enabled: !c.enabled }));
        case 'xpmodal':
            return interaction.showModal(modal('lvl:cfg:xp', 'XP & cooldown',
                input('min', 'Minimum XP per message', { value: c.xpMin, max: 4 }),
                input('max', 'Maximum XP per message', { value: c.xpMax, max: 4 }),
                input('cd', 'Cooldown in seconds (0–3600)', { value: c.cooldownSec, max: 4 })));
        case 'progmodal':
            return interaction.showModal(modal('lvl:cfg:prog', 'Custom progression',
                input('a', 'a  (n² coefficient)', { value: c.progression.a, max: 8 }),
                input('b', 'b  (n coefficient)', { value: c.progression.b, max: 8 }),
                input('c', 'c  (base XP, at least 1)', { value: c.progression.c, max: 8 })));
        case 'preset': {
            const p = cfg.PRESETS[interaction.values[0]];
            if (!p) return show('general');
            const next = await configService.update(guildId, { progression: { a: p.a, b: p.b, c: p.c } });
            await xpService.recomputeLevels(guildId, next.progression).catch(err => console.error('❌ [leveling] recompute failed:', err.message));
            return show('general', next);
        }

        // announcements
        case 'atoggle': return show('announce', await configService.update(guildId, { announce: { ...c.announce, enabled: !c.announce.enabled } }));
        case 'aclear':  return show('announce', await configService.update(guildId, { announce: { ...c.announce, channelId: null } }));
        case 'amsg':
            return interaction.showModal(modal('lvl:cfg:amsg', 'Level-up message',
                input('msg', 'Message ({user} {level} {title} {xp} {server})', { value: c.announce.message, style: TextInputStyle.Paragraph, max: LIMITS.MAX_MESSAGE_LENGTH })));
        case 'achan': {
            const channel = interaction.channels?.first() ?? interaction.guild.channels.cache.get(interaction.values[0]);
            const me = interaction.guild.members.me;
            const next = await configService.update(guildId, { announce: { ...c.announce, channelId: interaction.values[0] } });
            await show('announce', next);
            if (channel && !channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
                await interaction.followUp({ content: `⚠️ I can't send messages in <#${channel.id}> yet — give me **View Channel** and **Send Messages** there. Until then I'll announce in the channel where the member chatted.`, flags: EPHEMERAL });
            }
            return;
        }

        // ignored
        case 'ichan': return show('ignored', await configService.update(guildId, { ignoredChannels: [...new Set(interaction.values)].slice(0, LIMITS.MAX_IGNORED) }));
        case 'irole': return show('ignored', await configService.update(guildId, { ignoredRoles: [...new Set(interaction.values)].slice(0, LIMITS.MAX_IGNORED) }));

        // rewards
        case 'rmode': {
            const next = await configService.update(guildId, { rewardMode: c.rewardMode === 'replace' ? 'stack' : 'replace' });
            return show('rewards', next);
        }
        case 'radd': {
            const role = interaction.guild.roles.cache.get(interaction.values[0]);
            const problem = rewardService.roleProblem(interaction.guild, role);
            if (problem) return interaction.reply({ content: `❌ I can't use ${role ? `<@&${role.id}>` : 'that role'} as a reward: ${problem}.`, flags: EPHEMERAL, allowedMentions: { parse: [] } });
            if (!c.rewards.some(r => r.roleId === role.id) && c.rewards.length >= LIMITS.MAX_REWARDS) {
                return interaction.reply({ content: `❌ You can have at most ${LIMITS.MAX_REWARDS} rewards.`, flags: EPHEMERAL });
            }
            const existing = c.rewards.find(r => r.roleId === role.id);
            return interaction.showModal(modal(`lvl:cfg:radd:${role.id}`, `Reward: ${role.name}`.slice(0, 45),
                input('level', `Level that unlocks this role (1–${LIMITS.MAX_LEVEL})`, { value: existing?.level, max: 4, placeholder: 'e.g. 10' })));
        }
        case 'rdel': return show('rewards', await configService.update(guildId, { rewards: c.rewards.filter(r => r.roleId !== interaction.values[0]) }));

        // manual XP
        case 't': {
            const mode = arg;
            if (!TOOL_TITLES[mode]) return;
            const rows = [input('member', 'Member ID or @mention', { max: 40, placeholder: '123456789012345678' })];
            if (mode === 'reset') rows.push(input('confirm', 'Type RESET to confirm', { max: 5 }));
            else rows.push(input('amount', mode === 'set' ? 'New total XP' : 'XP amount', { max: 9, placeholder: 'e.g. 500' }));
            return interaction.showModal(modal(`lvl:cfg:t:${mode}`, TOOL_TITLES[mode], ...rows));
        }
        default: return;
    }
}

// ── Modal submits ────────────────────────────────────────────────────────────
async function handleModal(interaction) {
    if (!isAdmin(interaction)) return interaction.reply({ content: '❌ You need the **Manage Server** permission.', flags: EPHEMERAL });
    const [, , action, arg] = interaction.customId.split(':');
    const guildId = interaction.guildId;
    const c = await configService.get(guildId);
    const field = id => interaction.fields.getTextInputValue(id);
    const fail = msg => interaction.reply({ content: `❌ ${msg}`, flags: EPHEMERAL });
    // Modals opened from a panel button/select can redraw the panel in place.
    const showPanel = (section, cfgNow) => interaction.isFromMessage()
        ? interaction.update(render(section, cfgNow, interaction.guild))
        : interaction.reply({ ...render(section, cfgNow, interaction.guild), flags: EPHEMERAL });

    if (action === 'xp') {
        const min = parseIntStrict(field('min'), 0, LIMITS.MAX_XP_PER_MESSAGE);
        const max = parseIntStrict(field('max'), 0, LIMITS.MAX_XP_PER_MESSAGE);
        const cd = parseIntStrict(field('cd'), LIMITS.MIN_COOLDOWN_SEC, LIMITS.MAX_COOLDOWN_SEC);
        if (min === null || max === null) return fail(`XP values must be whole numbers from 0 to ${LIMITS.MAX_XP_PER_MESSAGE}.`);
        if (max < 1) return fail('The maximum XP must be at least 1.');
        if (min > max) return fail('The minimum can\'t be higher than the maximum.');
        if (cd === null) return fail(`The cooldown must be 0–${LIMITS.MAX_COOLDOWN_SEC} seconds.`);
        return showPanel('general', await configService.update(guildId, { xpMin: min, xpMax: max, cooldownSec: cd }));
    }

    if (action === 'prog') {
        const p = { a: parseNum(field('a'), 0, LIMITS.MAX_COEFFICIENT), b: parseNum(field('b'), 0, LIMITS.MAX_COEFFICIENT), c: parseNum(field('c'), 1, LIMITS.MAX_COEFFICIENT) };
        if (!validateProgression(p)) return fail(`a and b must be numbers from 0 to ${LIMITS.MAX_COEFFICIENT}, and c from 1 to ${LIMITS.MAX_COEFFICIENT}.`);
        const next = await configService.update(guildId, { progression: p });
        await xpService.recomputeLevels(guildId, next.progression).catch(err => console.error('❌ [leveling] recompute failed:', err.message));
        return showPanel('general', next);
    }

    if (action === 'amsg') {
        const msg = field('msg').trim();
        if (!msg) return fail('The message can\'t be empty.');
        return showPanel('announce', await configService.update(guildId, { announce: { ...c.announce, message: msg.slice(0, LIMITS.MAX_MESSAGE_LENGTH) } }));
    }

    if (action === 'radd') {
        const level = parseIntStrict(field('level'), 1, LIMITS.MAX_LEVEL);
        if (level === null) return fail(`Enter a whole number from 1 to ${LIMITS.MAX_LEVEL}.`);
        const role = interaction.guild.roles.cache.get(arg);
        const problem = rewardService.roleProblem(interaction.guild, role);
        if (problem) return fail(`I can't use that role: ${problem}.`);
        const rewards = c.rewards.filter(r => r.roleId !== arg);
        if (rewards.length >= LIMITS.MAX_REWARDS) return fail(`You can have at most ${LIMITS.MAX_REWARDS} rewards.`);
        rewards.push({ level, roleId: arg });
        return showPanel('rewards', await configService.update(guildId, { rewards }));
    }

    if (action === 't') {
        const mode = arg;
        const userId = parseUserId(field('member'));
        if (!userId) return fail('I couldn\'t read that member. Paste their user ID or @mention.');
        let amount = 0;
        if (mode === 'reset') {
            if (field('confirm').trim().toUpperCase() !== 'RESET') return fail('Reset cancelled — you must type RESET.');
        } else {
            amount = parseIntStrict(field('amount'), 0, LIMITS.MAX_MANUAL_XP);
            if (amount === null) return fail(`The amount must be a whole number from 0 to ${fmt(LIMITS.MAX_MANUAL_XP)}.`);
        }

        const member = await interaction.guild.members.fetch(userId).catch(() => null);
        if (member?.user.bot) return fail('Bots don\'t earn XP.');
        if (!member && mode !== 'reset') return fail('That user isn\'t in this server.');

        let summary;
        if (mode === 'reset') {
            const had = await xpService.resetMember(guildId, userId);
            if (member) await rewardService.syncMemberRewards(member, 0, c, { strip: true });
            summary = had ? `🗑️ Reset <@${userId}> — XP, level and weekly/monthly progress cleared.` : `<@${userId}> had no XP to reset.`;
        } else {
            const r = await xpService.adjustXp(guildId, userId, member.displayName.slice(0, 64), mode, amount, c.progression);
            const sync = await rewardService.syncMemberRewards(member, r.newLevel, c, { strip: true });
            summary = `✅ <@${userId}>: **${fmt(r.oldXp)} → ${fmt(r.newXp)} XP** (level ${r.oldLevel} → ${r.newLevel}).`;
            if (sync.granted.length) summary += `\n🏅 Granted: ${sync.granted.map(x => x.name).join(', ')}`;
            if (sync.removed.length) summary += `\n➖ Removed: ${sync.removed.map(x => x.name).join(', ')}`;
            if (sync.problems.length) summary += `\n⚠️ ${sync.problems.join('; ')}`;
        }
        if (interaction.isFromMessage()) await interaction.update(render('tools', c, interaction.guild));
        return interaction.followUp({ content: summary, flags: EPHEMERAL, allowedMentions: { parse: [] } });
    }
}

module.exports = { open, handleComponent, handleModal, render, isAdmin };

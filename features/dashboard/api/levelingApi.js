// features/dashboard/api/levelingApi.js
// Leveling endpoints. Reuses the same services as the Discord commands, so the website and
// /level-config always agree. Input is validated with the same limits as the Discord panel.
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const cfgL = require('../../leveling/config/levelingConfig');
const configService = require('../../leveling/services/configService');
const xpService = require('../../leveling/services/xpService');
const rewardService = require('../../leveling/services/rewardService');
const { validateProgression, levelFromXp, progress, totalXpForLevel } = require('../../leveling/utils/levelMath');
const { HttpError } = require('../services/guildAccess');

const { LIMITS } = cfgL;
const TEXT_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
const IGNORABLE_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildForum]);

const bad = msg => new HttpError(400, 'invalid', msg);
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const isSnowflake = v => typeof v === 'string' && /^\d{15,25}$/.test(v);

// ── Guild snapshot ───────────────────────────────────────────────────────────
function channelList(guild) {
    const me = guild.members.me;
    return [...guild.channels.cache.values()]
        .filter(c => IGNORABLE_TYPES.has(c.type))
        .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0))
        .map(c => ({
            id: c.id, name: c.name, type: c.type,
            kind: TEXT_TYPES.has(c.type) ? 'text' : c.type === ChannelType.GuildForum ? 'forum' : 'voice',
            canSend: TEXT_TYPES.has(c.type) && !!me && !!c.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])
        }));
}

function roleList(guild) {
    return [...guild.roles.cache.values()]
        .filter(r => r.id !== guild.id)
        .sort((a, b) => b.position - a.position)
        .map(r => ({ id: r.id, name: r.name, color: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : null, problem: rewardService.roleProblem(guild, r) }));
}

async function guildSnapshot(guild) {
    const leveling = await configService.get(guild.id);
    return {
        guild: { id: guild.id, name: guild.name, icon: guild.iconURL({ size: 128, extension: 'png' }), memberCount: guild.memberCount },
        channels: channelList(guild),
        roles: roleList(guild),
        leveling: publicConfig(leveling),
        limits: LIMITS,
        presets: Object.entries(cfgL.PRESETS).map(([id, p]) => ({ id, label: p.label, a: p.a, b: p.b, c: p.c })),
        ranked: await xpService.countMembers(guild.id)
    };
}

function publicConfig(c) {
    return {
        enabled: c.enabled, xpMin: c.xpMin, xpMax: c.xpMax, cooldownSec: c.cooldownSec, progression: c.progression,
        announce: c.announce, rewardMode: c.rewardMode, rewards: [...c.rewards].sort((a, b) => a.level - b.level),
        ignoredChannels: c.ignoredChannels, ignoredRoles: c.ignoredRoles
    };
}

// ── Validation of PUT body → { changes, progressionChanged } ────────────────
function validateUpdate(body, current, guild) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('Send a JSON object.');
    const changes = {};
    const allowed = ['enabled', 'xpMin', 'xpMax', 'cooldownSec', 'progression', 'announce', 'rewardMode', 'rewards', 'ignoredChannels', 'ignoredRoles'];
    for (const k of Object.keys(body)) if (!allowed.includes(k)) throw bad(`Unknown setting "${k}".`);

    if ('enabled' in body) { if (typeof body.enabled !== 'boolean') throw bad('enabled must be true or false.'); changes.enabled = body.enabled; }

    if ('xpMin' in body || 'xpMax' in body) {
        const min = 'xpMin' in body ? body.xpMin : current.xpMin;
        const max = 'xpMax' in body ? body.xpMax : current.xpMax;
        if (!isInt(min, 0, LIMITS.MAX_XP_PER_MESSAGE) || !isInt(max, 0, LIMITS.MAX_XP_PER_MESSAGE)) throw bad(`XP values must be whole numbers from 0 to ${LIMITS.MAX_XP_PER_MESSAGE}.`);
        if (max < 1) throw bad('The maximum XP must be at least 1.');
        if (min > max) throw bad('The minimum XP can\'t be higher than the maximum.');
        changes.xpMin = min; changes.xpMax = max;
    }
    if ('cooldownSec' in body) {
        if (!isInt(body.cooldownSec, LIMITS.MIN_COOLDOWN_SEC, LIMITS.MAX_COOLDOWN_SEC)) throw bad(`Cooldown must be a whole number of seconds from ${LIMITS.MIN_COOLDOWN_SEC} to ${LIMITS.MAX_COOLDOWN_SEC}.`);
        changes.cooldownSec = body.cooldownSec;
    }
    let progressionChanged = false;
    if ('progression' in body) {
        const p = body.progression;
        const next = { a: Number(p?.a), b: Number(p?.b), c: Number(p?.c) };
        if (!validateProgression(next)) throw bad(`Progression: a and b must be 0–${LIMITS.MAX_COEFFICIENT}, c must be 1–${LIMITS.MAX_COEFFICIENT}.`);
        changes.progression = next;
        progressionChanged = next.a !== current.progression.a || next.b !== current.progression.b || next.c !== current.progression.c;
    }
    if ('announce' in body) {
        const a = body.announce;
        if (!a || typeof a !== 'object') throw bad('announce must be an object.');
        const next = { ...current.announce };
        if ('enabled' in a) { if (typeof a.enabled !== 'boolean') throw bad('announce.enabled must be true or false.'); next.enabled = a.enabled; }
        if ('message' in a) {
            if (typeof a.message !== 'string' || !a.message.trim() || a.message.length > LIMITS.MAX_MESSAGE_LENGTH) throw bad(`The announcement message must be 1–${LIMITS.MAX_MESSAGE_LENGTH} characters.`);
            next.message = a.message.trim();
        }
        if ('channelId' in a) {
            if (a.channelId !== null) {
                const ch = guild.channels.cache.get(a.channelId);
                if (!ch || !TEXT_TYPES.has(ch.type)) throw bad('Pick a text channel from this server.');
            }
            next.channelId = a.channelId;
        }
        changes.announce = next;
    }
    if ('rewardMode' in body) { if (!['stack', 'replace'].includes(body.rewardMode)) throw bad('rewardMode must be "stack" or "replace".'); changes.rewardMode = body.rewardMode; }

    if ('rewards' in body) {
        if (!Array.isArray(body.rewards) || body.rewards.length > LIMITS.MAX_REWARDS) throw bad(`At most ${LIMITS.MAX_REWARDS} rewards.`);
        const seen = new Set(); const existing = new Set(current.rewards.map(r => r.roleId));
        changes.rewards = body.rewards.map(r => {
            if (!r || !isInt(r.level, 1, LIMITS.MAX_LEVEL)) throw bad(`Reward levels must be whole numbers from 1 to ${LIMITS.MAX_LEVEL}.`);
            if (!isSnowflake(r.roleId) || seen.has(r.roleId)) throw bad('Each reward needs a different, valid role.');
            seen.add(r.roleId);
            const role = guild.roles.cache.get(r.roleId);
            if (!role) throw bad('One of the reward roles no longer exists.');
            // Roles already configured stay valid even if the bot's position changed; NEW ones must be assignable.
            const problem = rewardService.roleProblem(guild, role);
            if (problem && !existing.has(r.roleId)) throw bad(`I can't use "${role.name}" as a reward: ${problem}.`);
            return { level: r.level, roleId: r.roleId };
        });
    }
    for (const [key, valid] of [['ignoredChannels', id => IGNORABLE_TYPES.has(guild.channels.cache.get(id)?.type)], ['ignoredRoles', id => guild.roles.cache.has(id) && id !== guild.id]]) {
        if (!(key in body)) continue;
        const arr = body[key];
        if (!Array.isArray(arr) || arr.length > LIMITS.MAX_IGNORED || !arr.every(id => isSnowflake(id) && valid(id))) throw bad(`${key}: up to ${LIMITS.MAX_IGNORED} valid items from this server.`);
        changes[key] = [...new Set(arr)];
    }
    if (!Object.keys(changes).length) throw bad('Nothing to change.');
    return { changes, progressionChanged };
}

// ── Handlers: (ctx) => result. ctx = { client, session, guild, body, query, params } ─────────
async function getGuild({ guild }) { return guildSnapshot(guild); }

async function putSettings({ guild, body }) {
    const current = await configService.get(guild.id);
    const { changes, progressionChanged } = validateUpdate(body, current, guild);
    const next = await configService.update(guild.id, changes);
    if (progressionChanged) await xpService.recomputeLevels(guild.id, next.progression).catch(err => console.error('❌ [dashboard] recompute failed:', err.message));
    return { leveling: publicConfig(next) };
}

async function getLeaderboard({ guild, query }) {
    const period = ['alltime', 'weekly', 'monthly'].includes(query.get('period')) ? query.get('period') : 'alltime';
    const page = Math.max(0, Math.min(100000, parseInt(query.get('page'), 10) || 0));
    const config = await configService.get(guild.id);
    const { total, rows } = await xpService.getLeaderboardPage(guild.id, period, page, cfgL.LEADERBOARD_PAGE_SIZE);
    return {
        period, page, pageSize: cfgL.LEADERBOARD_PAGE_SIZE, total,
        rows: rows.map((r, i) => ({ rank: page * cfgL.LEADERBOARD_PAGE_SIZE + i + 1, userId: r.userId, username: r.username, xp: r.xp, level: levelFromXp(r.xp, config.progression) }))
    };
}

async function getMember({ guild, params }) {
    if (!isSnowflake(params.userId)) throw bad('That is not a valid user ID.');
    const config = await configService.get(guild.id);
    const doc = await xpService.getMember(guild.id, params.userId);
    const xp = doc?.xp ?? 0;
    const p = progress(xp, config.progression);
    const member = guild.members.cache.get(params.userId) || await guild.members.fetch(params.userId).catch(() => null);
    return {
        userId: params.userId, inServer: !!member, isBot: !!member?.user.bot,
        username: member?.displayName ?? doc?.username ?? null,
        xp, level: p.level, messages: doc?.messages ?? 0,
        rank: doc && xp > 0 ? await xpService.getRank(guild.id, params.userId, xp) : null,
        nextLevelAt: p.atMax ? null : totalXpForLevel(p.level + 1, config.progression)
    };
}

async function postXp({ guild, body, session }) {
    const mode = body?.mode;
    if (!['add', 'remove', 'set', 'reset'].includes(mode)) throw bad('mode must be add, remove, set or reset.');
    if (!isSnowflake(body?.userId)) throw bad('That is not a valid user ID.');
    const config = await configService.get(guild.id);
    const member = await guild.members.fetch(body.userId).catch(() => null);
    if (member?.user.bot) throw bad('Bots don\'t earn XP.');
    console.log(`📝 [dashboard] ${session.userId} ${mode} xp for ${body.userId} in ${guild.id}`);

    if (mode === 'reset') {
        const had = await xpService.resetMember(guild.id, body.userId);
        const sync = member ? await rewardService.syncMemberRewards(member, 0, config, { strip: true }) : null;
        return { mode, changed: had, removedRoles: sync?.removed.map(r => r.name) ?? [], problems: sync?.problems ?? [] };
    }
    if (!isInt(body.amount, 0, LIMITS.MAX_MANUAL_XP)) throw bad(`The amount must be a whole number from 0 to ${LIMITS.MAX_MANUAL_XP}.`);
    if (!member) throw bad('That user isn\'t in this server.');
    const r = await xpService.adjustXp(guild.id, body.userId, member.displayName.slice(0, 64), mode, body.amount, config.progression);
    const sync = await rewardService.syncMemberRewards(member, r.newLevel, config, { strip: true });
    return { mode, ...r, grantedRoles: sync.granted.map(x => x.name), removedRoles: sync.removed.map(x => x.name), problems: sync.problems };
}

module.exports = { getGuild, putSettings, getLeaderboard, getMember, postXp, validateUpdate, guildSnapshot };

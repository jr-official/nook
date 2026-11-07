// features/leveling/services/rewardService.js
// Level -> role rewards. Never throws: every Discord failure is turned into a reason string.
const { PermissionFlagsBits } = require('discord.js');

// Why the bot cannot hand out `role` (null = it can).
function roleProblem(guild, role) {
    if (!role) return 'the role no longer exists';
    if (role.id === guild.id) return '@everyone cannot be a reward';
    if (role.managed) return 'it is managed by an integration';
    const me = guild.members.me;
    if (!me) return 'the bot member is not loaded';
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) return 'the bot lacks the Manage Roles permission';
    if (role.position >= me.roles.highest.position) return 'it is above the bot\'s highest role';
    return null;
}

// Which reward roles a member at `level` should hold.
//   stack   -> every reward whose level <= member level
//   replace -> only the highest reached milestone (all roles configured at that level)
function targetRewards(config, level) {
    const eligible = config.rewards.filter(r => r.level <= level).sort((a, b) => a.level - b.level);
    if (config.rewardMode !== 'replace' || !eligible.length) return eligible;
    const top = eligible[eligible.length - 1].level;
    return eligible.filter(r => r.level === top);
}

// Brings the member's reward roles in line with their level.
// -> { granted: Role[], removed: Role[], problems: string[] }
// `strip: true` also removes reward roles the member no longer qualifies for (manual XP changes);
// ordinary level-ups never take roles away in stack mode.
async function syncMemberRewards(member, level, config, { strip = false } = {}) {
    const out = { granted: [], removed: [], problems: [] };
    if (!member || !config.rewards.length) return out;
    const guild = member.guild;

    const wanted = targetRewards(config, level);
    const wantedIds = new Set(wanted.map(r => r.roleId));

    const toAdd = [];
    for (const r of wanted) {
        if (member.roles.cache.has(r.roleId)) continue;
        const role = guild.roles.cache.get(r.roleId);
        const problem = roleProblem(guild, role);
        if (problem) { out.problems.push(`<@&${r.roleId}>: ${problem}`); continue; }
        toAdd.push(role);
    }
    if (toAdd.length) {
        try {
            await member.roles.add(toAdd, 'Leveling reward');
            out.granted.push(...toAdd);
        } catch (err) {
            out.problems.push(`could not add roles (${err.code || err.message})`);
        }
    }

    if (config.rewardMode === 'replace' || strip) {
        const toRemove = [];
        for (const r of config.rewards) {
            if (wantedIds.has(r.roleId) || !member.roles.cache.has(r.roleId)) continue;
            const role = guild.roles.cache.get(r.roleId);
            if (role && !roleProblem(guild, role)) toRemove.push(role);
        }
        if (toRemove.length) {
            try {
                await member.roles.remove(toRemove, 'Leveling reward replaced');
                out.removed.push(...toRemove);
            } catch (err) {
                out.problems.push(`could not remove old roles (${err.code || err.message})`);
            }
        }
    }
    return out;
}

module.exports = { roleProblem, targetRewards, syncMemberRewards };

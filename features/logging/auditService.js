// features/logging/auditService.js — who did it? Looks the action up in the audit log.
// Needs View Audit Log; without it every lookup quietly returns null and the log says "unknown".
const { AuditLogEvent } = require('discord.js');
const caseService = require('../moderation/services/caseService');

const wait = ms => new Promise(r => setTimeout(r, ms));

async function findAudit(guild, type, targetId, { windowMs = 20000, delayMs = 1500 } = {}) {
    if (delayMs) await wait(delayMs);
    try {
        const logs = await guild.fetchAuditLogs({ type, limit: 10 });
        const now = Date.now();
        for (const e of logs.entries.values()) {
            if (e.target?.id === targetId && now - e.createdTimestamp <= windowMs) return e;
        }
    } catch { /* no permission or API error */ }
    return null;
}

// True when this action is already recorded: done by the bot itself, or a case was saved moments ago.
async function alreadyHandled(client, guild, entry, userId, type) {
    if (entry?.executor?.id && entry.executor.id === client.user?.id) return true;
    try { return !!(await caseService.recent(guild.id, userId, type, 120000)); } catch { return false; }
}

module.exports = { findAudit, alreadyHandled, AuditLogEvent };

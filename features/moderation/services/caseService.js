// features/moderation/services/caseService.js
// The moderation database: one document per moderation action (ban, kick, mute, warn, ...),
// keyed by the human-readable caseId. Everything else (history, appeals, dashboard, escalation)
// reads from here. Warnings keep their own collection; each warn also gets a case entry.
const databaseService = require('../../tickets/services/databaseService');

const COLLECTION = 'modcases';
const TYPES = ['ban', 'softban', 'unban', 'kick', 'mute', 'unmute', 'warn', 'warn_remove'];
// Case types that stay "active" until lifted or expired.
const LIFTABLE = { ban: 'unban', mute: 'unmute' };

const col = () => databaseService.getCollection(COLLECTION);

function buildDoc(guildId, a, caseId) {
    return {
        caseId, guildId, type: a.type,
        userId: a.target?.id ?? null, username: a.target?.tag ?? null,
        moderatorId: a.moderator?.id ?? null, moderatorTag: a.moderator?.tag ?? null,
        reason: String(a.reason ?? '').slice(0, 1000),
        proof: a.proof ?? null,
        duration: a.duration ?? null,
        expiresAt: a.expiresAt instanceof Date ? a.expiresAt : null,
        dmSent: a.dmSent ?? null,
        severity: a.type === 'warn' ? (Number.isInteger(a.severity) ? a.severity : 0) : null,
        relatedCaseId: a.removedCaseId ?? null,
        createdAt: new Date(),
        active: a.type in LIFTABLE
    };
}

// Insert a case, then lift earlier ban/mute cases when this one is the matching undo.
async function record(guildId, action, caseId) {
    if (!TYPES.includes(action.type) || !action.target?.id) return null;
    const doc = buildDoc(guildId, action, caseId);
    try { await col().insertOne(doc); }
    catch (e) { if (e.code === 11000) return null; throw e; }

    const lifts = Object.keys(LIFTABLE).find(t => LIFTABLE[t] === action.type);
    if (lifts) {
        await col().updateMany(
            { guildId, userId: doc.userId, type: lifts, active: true },
            { $set: { active: false, liftedAt: new Date(), liftedBy: doc.moderatorId, liftedByCase: caseId, liftedReason: 'manual' } }
        );
    }
    return doc;
}

const get = (guildId, caseId) => col().findOne({ guildId, caseId: String(caseId).toUpperCase() });

const forUser = (guildId, userId, limit = 50) =>
    col().find({ guildId, userId }).sort({ createdAt: -1 }).limit(limit).toArray();

// Temp bans whose time is up and that have not been lifted yet.
const dueBans = (now = new Date(), limit = 50) =>
    col().find({ type: 'ban', active: true, expiresAt: { $lte: now } }).limit(limit).toArray();

const markExpired = (doc, reason = 'expired') =>
    col().updateOne({ _id: doc._id, active: true }, { $set: { active: false, liftedAt: new Date(), liftedReason: reason } });

// Mirror warnings that predate the case database. Safe to run on every start.
async function backfillWarnings(warnings) {
    const docs = await warnings.find({ caseId: { $exists: true } }).toArray();
    let added = 0;
    for (const w of docs) {
        if (await col().findOne({ caseId: w.caseId })) continue;
        try {
            await col().insertOne({
                caseId: w.caseId, guildId: w.guildId, type: 'warn', userId: w.userId, username: w.username,
                moderatorId: w.moderatorId, moderatorTag: w.moderatorTag, reason: w.reason, proof: w.proof ?? null,
                duration: null, expiresAt: null, dmSent: w.dmSent ?? null, relatedCaseId: null,
                createdAt: w.createdAt, active: false, backfilled: true
            });
            added++;
        } catch (e) { if (e.code !== 11000) throw e; }
    }
    return added;
}

async function ensureIndexes() {
    try {
        await col().createIndexes([
            { key: { caseId: 1 }, unique: true },
            { key: { guildId: 1, userId: 1, createdAt: -1 } },
            { key: { guildId: 1, createdAt: -1 } },
            { key: { type: 1, active: 1, expiresAt: 1 } }
        ]);
    } catch (e) { console.error('❌ Error creating case indexes:', e); }
}

module.exports = { _col: col, record, get, forUser, dueBans, markExpired, backfillWarnings, ensureIndexes, TYPES };

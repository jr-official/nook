// features/moderation/services/warningService.js
const { ObjectId } = require('mongodb');
const databaseService = require('../../tickets/services/databaseService');
const { generateCaseId } = require('../utils/caseID');
const { WARN_DECAY_DAYS } = require('../config/moderationConfig');

const clampSeverity = v => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? Math.min(3, Math.max(0, n)) : 0; };
// Points a warning counts for right now (0 once it has decayed).
const pointsOf = (w, now = Date.now(), decayDays = WARN_DECAY_DAYS) =>
    decayDays > 0 && now - new Date(w.createdAt).getTime() > decayDays * 86400000 ? 0 : clampSeverity(w.severity);

class WarningService {
    constructor() { this.collection = 'warnings'; }

    _col() { return databaseService.getCollection(this.collection); }

    // FIX (Bug 5): addWarning catches MongoDB duplicate key errors (code 11000)
    // on the caseId unique index and retries once with a freshly generated ID.
    async addWarning(guildId, targetUser, moderatorUser, reason, proof, dmSent, severity = 0) {
        const buildDoc = (caseId) => ({
            caseId,
            guildId,
            userId:       targetUser.id,
            username:     targetUser.tag,
            moderatorId:  moderatorUser.id,
            moderatorTag: moderatorUser.tag,
            reason,
            severity: clampSeverity(severity),
            proof:    proof || null,
            dmSent:   dmSent ?? false,
            createdAt: new Date(),
            active:    true
        });

        let caseId  = generateCaseId('warn');
        let warning = buildDoc(caseId);

        try {
            const result = await this._col().insertOne(warning);
            return { ...warning, _id: result.insertedId };
        } catch (err) {
            if (err.code !== 11000) throw err;
            console.warn(`[WarningService] Duplicate caseId "${caseId}" — retrying with new ID`);
            caseId  = generateCaseId('warn');
            warning = buildDoc(caseId);
            const result = await this._col().insertOne(warning);
            return { ...warning, _id: result.insertedId };
        }
    }

    // FIX (Bug 1): markDmSent no longer swallows all errors indiscriminately.
    async markDmSent(warningId, sent = true) {
        let objectId;
        if (warningId instanceof ObjectId) {
            objectId = warningId;
        } else {
            try {
                objectId = new ObjectId(warningId);
            } catch {
                console.warn('[WarningService] markDmSent: invalid warningId format:', warningId);
                return;
            }
        }
        await this._col().updateOne({ _id: objectId }, { $set: { dmSent: sent } });
    }

    async removeWarningById(warningId) {
        let objectId;
        try { objectId = new ObjectId(warningId); } catch { return null; }
        const warning = await this._col().findOne({ _id: objectId, active: true });
        if (!warning) return null;
        await this._col().updateOne({ _id: objectId }, { $set: { active: false, removedAt: new Date() } });
        return warning;
    }

    // Guild-scoped removal by case id (used by the dashboard). Same soft-delete as removeWarningById,
    // but the case id must belong to this guild, so one server can never remove another's case.
    async removeByCaseId(guildId, caseId, removedBy = null) {
        const warning = await this._col().findOne({ guildId, caseId, active: true });
        if (!warning) return null;
        const res = await this._col().updateOne(
            { _id: warning._id, guildId, active: true },
            { $set: { active: false, removedAt: new Date(), ...(removedBy ? { removedBy } : {}) } }
        );
        return res.modifiedCount === 0 ? null : warning;
    }

    async getUserWarnings(guildId, userId) {
        return await this._col().find({ guildId, userId, active: true }).sort({ createdAt: -1 }).toArray();
    }

    async getUserWarningCount(guildId, userId) {
        return await this._col().countDocuments({ guildId, userId, active: true });
    }

    // Weighted points for one member (active warnings only, decay applied).
    async getUserPoints(guildId, userId) {
        const docs = await this._col().find({ guildId, userId, active: true }).toArray();
        return docs.reduce((a, w) => a + pointsOf(w), 0);
    }

    // Members with active warnings, most weighted points first, then most warnings.
    // Done in JS (not an aggregate) because decay is a per-warning date test; one server stays small.
    async getGuildLeaderboard(guildId) {
        const docs = await this._col().find({ guildId, active: true }).sort({ createdAt: 1 }).limit(20000).toArray();
        const by = new Map();
        for (const w of docs) {
            const e = by.get(w.userId) ?? { userId: w.userId, username: w.username, count: 0, points: 0 };
            e.username = w.username; e.count++; e.points += pointsOf(w);
            by.set(w.userId, e);
        }
        return [...by.values()].sort((a, b) => b.points - a.points || b.count - a.count || (a.userId < b.userId ? -1 : 1));
    }

    async ensureIndexes() {
        try {
            await this._col().createIndexes([
                { key: { guildId: 1, userId: 1, active: 1 } },
                { key: { guildId: 1, active: 1 } },
                // Must stay `sparse: true`: the live database already has caseId_1 created as
                // sparse, and MongoDB refuses to create an index with the same name but different
                // options (IndexKeySpecsConflict), which made this whole call fail on every start.
                { key: { caseId: 1 }, unique: true, sparse: true },
                { key: { createdAt: -1 } }
            ]);
            console.log('✅ Warning indexes ensured');
        } catch (error) {
            console.error('❌ Error creating warning indexes:', error);
        }
    }
}

const service = new WarningService();
service.pointsOf = pointsOf;
service.clampSeverity = clampSeverity;
module.exports = service;
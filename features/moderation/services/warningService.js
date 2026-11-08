// features/moderation/services/warningService.js
const { ObjectId } = require('mongodb');
const databaseService = require('../../tickets/services/databaseService');
const { generateCaseId } = require('../utils/caseID');

class WarningService {
    constructor() { this.collection = 'warnings'; }

    _col() { return databaseService.getCollection(this.collection); }

    // FIX (Bug 5): addWarning catches MongoDB duplicate key errors (code 11000)
    // on the caseId unique index and retries once with a freshly generated ID.
    async addWarning(guildId, targetUser, moderatorUser, reason, proof, dmSent) {
        const buildDoc = (caseId) => ({
            caseId,
            guildId,
            userId:       targetUser.id,
            username:     targetUser.tag,
            moderatorId:  moderatorUser.id,
            moderatorTag: moderatorUser.tag,
            reason,
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

    async getUserWarnings(guildId, userId) {
        return await this._col().find({ guildId, userId, active: true }).sort({ createdAt: -1 }).toArray();
    }

    async getUserWarningCount(guildId, userId) {
        return await this._col().countDocuments({ guildId, userId, active: true });
    }

    // FIX: added a $sort stage before $group so that $last always picks the
    // most recently created document's username. Without the sort, MongoDB
    // processes documents in storage order (undefined), meaning a user who
    // changed their Discord username could show their old name in the
    // leaderboard indefinitely.
    async getGuildLeaderboard(guildId) {
        return await this._col().aggregate([
            { $match: { guildId, active: true } },
            { $sort: { createdAt: 1 } },
            { $group: { _id: '$userId', username: { $last: '$username' }, count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } },
            { $project: { _id: 0, userId: '$_id', username: '$username', count: '$count' } }
        ]).toArray();
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

module.exports = new WarningService();
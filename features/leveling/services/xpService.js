// features/leveling/services/xpService.js
//
// Member progression. Two collections, both keyed by guild so servers never mix:
//   level_members  { guildId, userId, xp, level, messages, lastXpAt, username }  — lifetime
//   level_periods  { guildId, userId, period, key, xp, expireAt }                — weekly / monthly
//
// Concurrency: awardMessageXp() is ONE atomic findOneAndUpdate whose filter only matches
// when the cooldown has elapsed, so two simultaneous messages (or two bot processes) can
// never both be paid. Level-ups are claimed with a compare-and-set on `level`, so a
// level-up is announced exactly once.
const databaseService = require('../../tickets/services/databaseService');
const cfg = require('../config/levelingConfig');
const { levelFromXp } = require('../utils/levelMath');
const { periodKey } = require('../utils/format');

const members = () => databaseService.getCollection(cfg.COLLECTIONS.members);
const periods = () => databaseService.getCollection(cfg.COLLECTIONS.periods);

async function ensureIndexes() {
    await members().createIndexes([
        { key: { guildId: 1, userId: 1 }, unique: true },
        { key: { guildId: 1, xp: -1, userId: 1 } }                  // leaderboard + rank
    ]);
    await periods().createIndexes([
        { key: { guildId: 1, userId: 1, period: 1, key: 1 }, unique: true },
        { key: { guildId: 1, period: 1, key: 1, xp: -1, userId: 1 } },
        { key: { expireAt: 1 }, expireAfterSeconds: 0 }              // TTL: old weeks/months vanish
    ]);
}

async function incPeriod(guildId, userId, period, amount, now) {
    const expireAt = new Date(now.getTime() + cfg.PERIOD_RETENTION_DAYS * 86400000);
    const run = () => periods().updateOne(
        { guildId, userId, period, key: periodKey(period, now) },
        { $inc: { xp: amount }, $set: { expireAt } },
        { upsert: true }
    );
    try { await run(); }
    catch (err) { if (err.code === 11000) await run(); else throw err; }   // two upserts raced: second one just increments
}

async function addPeriodXp(guildId, userId, amount, now) {
    if (amount <= 0) return;
    await Promise.all(['weekly', 'monthly'].map(p => incPeriod(guildId, userId, p, amount, now)));
}

// Returns { awarded: false } when on cooldown, otherwise
// { awarded: true, doc, amount, leveledUp, oldLevel, newLevel }.
async function awardMessageXp(guildId, userId, username, amount, cooldownSec, progression) {
    const now = new Date();
    const cutoff = new Date(now.getTime() - cooldownSec * 1000);
    let doc;
    try {
        doc = await members().findOneAndUpdate(
            { guildId, userId, $or: [{ lastXpAt: { $lte: cutoff } }, { lastXpAt: { $exists: false } }] },
            {
                $inc: { xp: amount, messages: 1 },
                $set: { lastXpAt: now, username },
                $setOnInsert: { guildId, userId, level: 0, createdAt: now }
            },
            { upsert: true, returnDocument: 'after' }
        );
    } catch (err) {
        // The row exists but the cooldown filter didn't match -> upsert collided with the
        // unique index. That is the normal "still on cooldown" path.
        if (err.code === 11000) return { awarded: false };
        throw err;
    }
    if (!doc) return { awarded: false };

    await addPeriodXp(guildId, userId, amount, now).catch(err => console.error('❌ [leveling] period xp failed:', err.message));

    const newLevel = levelFromXp(doc.xp, progression);
    // Raise the stored level only if it is lower. The pre-image tells us which level this
    // caller moved the member FROM, so concurrent awards each claim their own distinct
    // step and every level-up is reported exactly once (never twice, never skipped).
    let leveledUp = false, oldLevel = doc.level ?? 0;
    const before = await members().findOneAndUpdate(
        { guildId, userId, level: { $lt: newLevel } },
        { $set: { level: newLevel } },
        { returnDocument: 'before' }
    );
    if (before) { leveledUp = true; oldLevel = before.level ?? 0; }
    return { awarded: true, doc, amount, leveledUp, oldLevel, newLevel };
}

async function getMember(guildId, userId) {
    return members().findOne({ guildId, userId });
}

// 1-based rank. Ties are broken by userId so rank always matches leaderboard order.
async function getRank(guildId, userId, xp) {
    const [higher, tiedBefore] = await Promise.all([
        members().countDocuments({ guildId, xp: { $gt: xp } }),
        members().countDocuments({ guildId, xp, userId: { $lt: userId } })
    ]);
    return higher + tiedBefore + 1;
}

async function countMembers(guildId) {
    return members().countDocuments({ guildId, xp: { $gt: 0 } });
}

// ── Leaderboards ─────────────────────────────────────────────────────────────
// -> { total, rows: [{ userId, username, xp }] }
async function getLeaderboardPage(guildId, period, page, pageSize = cfg.LEADERBOARD_PAGE_SIZE) {
    const skip = page * pageSize;
    if (period === 'weekly' || period === 'monthly') {
        const filter = { guildId, period, key: periodKey(period), xp: { $gt: 0 } };
        const [total, rows] = await Promise.all([
            periods().countDocuments(filter),
            periods().find(filter).sort({ xp: -1, userId: 1 }).skip(skip).limit(pageSize).toArray()
        ]);
        // usernames are stored on the lifetime row
        const names = await members().find({ guildId, userId: { $in: rows.map(r => r.userId) } }, { projection: { userId: 1, username: 1 } }).toArray();
        const byId = new Map(names.map(n => [n.userId, n.username]));
        return { total, rows: rows.map(r => ({ userId: r.userId, username: byId.get(r.userId) || null, xp: r.xp })) };
    }
    const filter = { guildId, xp: { $gt: 0 } };
    const [total, rows] = await Promise.all([
        members().countDocuments(filter),
        members().find(filter).sort({ xp: -1, userId: 1 }).skip(skip).limit(pageSize).toArray()
    ]);
    return { total, rows: rows.map(r => ({ userId: r.userId, username: r.username || null, xp: r.xp })) };
}

async function getPeriodXp(guildId, userId, period) {
    const doc = await periods().findOne({ guildId, userId, period, key: periodKey(period) });
    return doc?.xp ?? 0;
}

// ── Manual adjustments (admin) ───────────────────────────────────────────────
// mode: 'add' | 'remove' | 'set'. Lifetime XP only; weekly/monthly are untouched except
// 'add', which also counts toward them. Returns { oldXp, newXp, oldLevel, newLevel }.
async function adjustXp(guildId, userId, username, mode, amount, progression) {
    const existing = await members().findOne({ guildId, userId });
    const oldXp = existing?.xp ?? 0;
    const oldLevel = existing?.level ?? levelFromXp(oldXp, progression);
    let newXp;
    if (mode === 'add') newXp = oldXp + amount;
    else if (mode === 'remove') newXp = Math.max(0, oldXp - amount);
    else newXp = Math.max(0, amount);
    newXp = Math.min(newXp, cfg.LIMITS.MAX_MANUAL_XP);
    const newLevel = levelFromXp(newXp, progression);
    const now = new Date();
    await members().updateOne(
        { guildId, userId },
        { $set: { xp: newXp, level: newLevel, username }, $setOnInsert: { guildId, userId, messages: 0, createdAt: now } },
        { upsert: true }
    );
    if (mode === 'add') await addPeriodXp(guildId, userId, amount, now).catch(() => {});
    return { oldXp, newXp, oldLevel, newLevel };
}

async function resetMember(guildId, userId) {
    const [m, p] = await Promise.all([
        members().deleteOne({ guildId, userId }),
        periods().deleteMany({ guildId, userId })
    ]);
    return m.deletedCount > 0 || p.deletedCount > 0;
}

// Recompute the stored `level` of every member after the progression formula changes.
// (No announcements, no role changes — admins can re-sync with manual tools if needed.)
async function recomputeLevels(guildId, progression) {
    const cursor = members().find({ guildId }, { projection: { xp: 1, level: 1 } });
    const ops = [];
    for await (const m of cursor) {
        const level = levelFromXp(m.xp, progression);
        if (level !== m.level) ops.push({ updateOne: { filter: { _id: m._id }, update: { $set: { level } } } });
        if (ops.length >= 500) { await members().bulkWrite(ops); ops.length = 0; }
    }
    if (ops.length) await members().bulkWrite(ops);
}

module.exports = {
    ensureIndexes, awardMessageXp, getMember, getRank, countMembers,
    getLeaderboardPage, getPeriodXp, adjustXp, resetMember, recomputeLevels
};

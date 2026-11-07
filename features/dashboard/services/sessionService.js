// features/dashboard/services/sessionService.js
// Login sessions: a random bearer token handed to the website once; only its SHA-256 hash is
// stored. Sessions and OAuth `state` values expire automatically (TTL indexes).
const crypto = require('crypto');
const databaseService = require('../../tickets/services/databaseService');
const cfg = require('../config/dashboardConfig');

const sessions = () => databaseService.getCollection(cfg.COLLECTIONS.sessions);
const states = () => databaseService.getCollection(cfg.COLLECTIONS.states);
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const rand = () => crypto.randomBytes(32).toString('base64url');

async function ensureIndexes() {
    await Promise.all([
        sessions().createIndexes([{ key: { tokenHash: 1 }, unique: true }, { key: { expireAt: 1 }, expireAfterSeconds: 0 }]),
        states().createIndexes([{ key: { stateHash: 1 }, unique: true }, { key: { expireAt: 1 }, expireAfterSeconds: 0 }])
    ]);
}

async function createState() {
    const state = rand();
    await states().insertOne({ stateHash: sha(state), expireAt: new Date(Date.now() + cfg.STATE_MINUTES * 60000) });
    return state;
}

// One-time: returns true only for a state we issued and that has not been used/expired.
async function consumeState(state) {
    if (typeof state !== 'string' || state.length > 100) return false;
    const doc = await states().findOneAndDelete({ stateHash: sha(state) });
    return !!doc && doc.expireAt > new Date();
}

async function createSession(user, guilds) {
    const token = rand();
    await sessions().insertOne({
        tokenHash: sha(token),
        userId: user.id, username: user.username, globalName: user.global_name ?? null, avatar: user.avatar ?? null,
        guilds,
        createdAt: new Date(),
        expireAt: new Date(Date.now() + cfg.SESSION_DAYS * 86400000)
    });
    return token;
}

async function getSession(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    const s = await sessions().findOne({ tokenHash: sha(token) });
    return s && s.expireAt > new Date() ? s : null;
}

async function deleteSession(token) {
    if (typeof token === 'string') await sessions().deleteOne({ tokenHash: sha(token) });
}

module.exports = { ensureIndexes, createState, consumeState, createSession, getSession, deleteSession };

// features/leveling/utils/antiSpam.js
// In-memory guards so low-effort messages never reach the database.
const crypto = require('crypto');
const { ANTI_SPAM } = require('../config/levelingConfig');

const recent = new Map();     // "guild:user" -> [{ hash, at }]
const attempts = new Map();   // "guild:user" -> last time we tried to pay XP (fast cooldown path)

// What counts as "real text": strip mentions, links and custom emoji, collapse spaces.
function cleanText(content) {
    return String(content || '')
        .replace(/<a?:\w+:\d+>/g, '')
        .replace(/<(@[!&]?|#)\d+>/g, '')
        .replace(/https?:\/\/\S+/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

const hashOf = text => crypto.createHash('sha1').update(text).digest('hex').slice(0, 16);

// -> null if the message may earn XP, otherwise a short reason string.
function checkContent(content) {
    const text = cleanText(content);
    if (text.length < ANTI_SPAM.MIN_TEXT_LENGTH) return 'too-short';
    if (new Set(text.replace(/\s/g, '')).size < ANTI_SPAM.MIN_UNIQUE_CHARS) return 'low-entropy';
    return null;
}

// Records the message and says whether it repeats one of the member's last few messages.
function isDuplicate(guildId, userId, content, now = Date.now()) {
    const key = `${guildId}:${userId}`;
    const hash = hashOf(cleanText(content));
    const list = (recent.get(key) || []).filter(e => now - e.at < ANTI_SPAM.DUPLICATE_WINDOW_MS);
    const dup = list.some(e => e.hash === hash);
    list.push({ hash, at: now });
    while (list.length > ANTI_SPAM.DUPLICATE_HISTORY) list.shift();
    recent.set(key, list);
    return dup;
}

// Cheap in-process cooldown gate (the database enforces the real one atomically).
function onCooldown(guildId, userId, cooldownMs, now = Date.now()) {
    const last = attempts.get(`${guildId}:${userId}`);
    return last !== undefined && now - last < cooldownMs;
}
function markAttempt(guildId, userId, now = Date.now()) { attempts.set(`${guildId}:${userId}`, now); }

// Keep memory bounded: drop entries nobody has touched for a while.
function sweep(now = Date.now()) {
    for (const [k, list] of recent) {
        const fresh = list.filter(e => now - e.at < ANTI_SPAM.DUPLICATE_WINDOW_MS);
        if (fresh.length) recent.set(k, fresh); else recent.delete(k);
    }
    for (const [k, t] of attempts) if (now - t > 3600 * 1000) attempts.delete(k);
}
const timer = setInterval(sweep, 5 * 60 * 1000);
timer.unref?.();

module.exports = { cleanText, checkContent, isDuplicate, onCooldown, markAttempt, sweep, _reset: () => { recent.clear(); attempts.clear(); } };

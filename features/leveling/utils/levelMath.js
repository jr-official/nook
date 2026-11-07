// features/leveling/utils/levelMath.js
//
// Level progression. The XP needed to go from level n to level n+1 is
//     need(n) = a*n² + b*n + c
// so the TOTAL xp needed to reach level L is the sum of need(0..L-1), which has a
// closed form. Levels are always derived from total XP, never stored independently
// of it (a stored copy exists only to detect level-ups atomically).

const { LIMITS } = require('../config/levelingConfig');

function xpToNext(level, p) {
    return Math.floor(p.a * level * level + p.b * level + p.c);
}

// Total XP required to reach `level`.
function totalXpForLevel(level, p) {
    if (level <= 0) return 0;
    const L = level;
    const sumSq  = (L - 1) * L * (2 * L - 1) / 6;   // Σ n²   for n = 0..L-1
    const sumLin = (L - 1) * L / 2;                 // Σ n
    return Math.floor(p.a * sumSq + p.b * sumLin + p.c * L);
}

// Highest level whose requirement is <= xp (binary search; totalXpForLevel is monotonic
// because c >= 1 and a, b >= 0).
function levelFromXp(xp, p) {
    if (!(xp > 0)) return 0;
    let lo = 0, hi = LIMITS.MAX_LEVEL;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (totalXpForLevel(mid, p) <= xp) lo = mid; else hi = mid - 1;
    }
    return lo;
}

// Everything a rank card / progress embed needs.
function progress(xp, p) {
    const level = levelFromXp(xp, p);
    const base = totalXpForLevel(level, p);
    const atMax = level >= LIMITS.MAX_LEVEL;
    const needed = atMax ? 0 : xpToNext(level, p);
    const into = atMax ? 0 : xp - base;
    return { level, xp, base, into, needed, remaining: atMax ? 0 : needed - into, ratio: atMax ? 1 : Math.min(1, into / needed), atMax };
}

function validateProgression(p) {
    const ok = v => Number.isFinite(v) && v >= 0 && v <= LIMITS.MAX_COEFFICIENT;
    return !!p && ok(p.a) && ok(p.b) && Number.isFinite(p.c) && p.c >= 1 && p.c <= LIMITS.MAX_COEFFICIENT;
}

module.exports = { xpToNext, totalXpForLevel, levelFromXp, progress, validateProgression };

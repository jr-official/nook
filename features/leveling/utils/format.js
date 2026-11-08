// features/leveling/utils/format.js
const nf = new Intl.NumberFormat('en-US');
const fmt = n => nf.format(Math.round(n));

// 1234 -> 1.2K, 1500000 -> 1.5M (rank card)
function compact(n) {
    n = Math.round(n);
    if (n < 1000) return String(n);
    if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, '') + 'K';
    return (n / 1e6).toFixed(n < 1e7 ? 2 : 1).replace(/\.?0+$/, '') + 'M';
}

// Replace {user} {username} {level} {xp} {server} {title} in an admin-written template.
function renderTemplate(template, vars) {
    return String(template).replace(/\{(user|username|level|xp|server|title)\}/gi, (_, k) => {
        const v = vars[k.toLowerCase()];
        return v === undefined || v === null ? '' : String(v);
    });
}

// ISO-8601 week key (UTC), e.g. "2026-W45", and month key "2026-11".
function periodKey(period, date = new Date()) {
    if (period === 'monthly') {
        return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    }
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);                 // Thursday of this week
    const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
    const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// Next reset moment (UTC) for a period, as a unix timestamp in seconds.
function nextReset(period, date = new Date()) {
    if (period === 'monthly') {
        return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / 1000);
    }
    const day = date.getUTCDay() || 7;                      // Mon=1..Sun=7
    const monday = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + (8 - day));
    return Math.floor(monday / 1000);
}

module.exports = { fmt, compact, renderTemplate, periodKey, nextReset };

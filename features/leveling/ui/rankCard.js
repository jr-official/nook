// features/leveling/ui/rankCard.js
// Renders the rank card PNG with @napi-rs/canvas (prebuilt binaries, no system libraries —
// works on Railway). Fonts are bundled in ../assets so rendering never depends on the host.
const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { compact, fmt } = require('../utils/format');

let fontsReady = false;
function ensureFonts() {
    if (fontsReady) return;
    fontsReady = true;
    try {
        GlobalFonts.registerFromPath(path.join(__dirname, '../assets/NookSans-Regular.otf'), 'NookSans');
        GlobalFonts.registerFromPath(path.join(__dirname, '../assets/NookSans-Bold.otf'), 'NookSans');
    } catch (err) {
        console.warn('⚠️ [leveling] could not register bundled fonts, using system default:', err.message);
    }
}
const FONT = '"NookSans", "DejaVu Sans", sans-serif';

const W = 934, H = 282;
const C = { bg1: '#0f0826', bg2: '#2a1368', panel: 'rgba(255,255,255,0.06)', amber: '#ffd28a', amber2: '#ff9f43', text: '#ece6ff', muted: '#bdb2e6', track: 'rgba(255,255,255,0.14)' };

// Only draw characters the bundled font has (Latin, Greek, Cyrillic, punctuation); emoji / CJK
// would render as boxes on a server without fallback fonts.
const unsupported = /[^ -ɏͰ-ϿЀ-ӿ -⁯₠-⃏]/g;
function safeName(name) {
    const cleaned = String(name || '').replace(unsupported, '').replace(/\s+/g, ' ').trim();
    return cleaned || 'Member';
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function fitText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
    return t + '…';
}

// Discord CDN only, 5 s timeout, 4 MB cap — a bad avatar never blocks or crashes the command.
async function fetchAvatar(url) {
    if (!url) return null;
    try {
        const u = new URL(url);
        if (u.protocol !== 'https:' || !/(^|\.)discordapp\.(com|net)$|(^|\.)discord\.com$/.test(u.hostname)) return null;
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 5000);
        try {
            const res = await fetch(url, { signal: ctl.signal });
            if (!res.ok) return null;
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.length > 4 * 1024 * 1024) return null;
            return await loadImage(buf);
        } finally { clearTimeout(timer); }
    } catch { return null; }
}

/**
 * @param {object} d { name, avatarUrl|avatarImage, level, xp, into, needed, ratio, atMax, rank, total, accent? }
 * @returns {Promise<Buffer>} PNG
 */
async function renderRankCard(d) {
    ensureFonts();
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // background
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, C.bg2); g.addColorStop(1, C.bg1);
    roundRect(ctx, 0, 0, W, H, 28); ctx.fillStyle = g; ctx.fill();
    ctx.save(); roundRect(ctx, 0, 0, W, H, 28); ctx.clip();
    const glow = ctx.createRadialGradient(W - 90, 20, 10, W - 90, 20, 330);
    glow.addColorStop(0, 'rgba(255,210,138,0.20)'); glow.addColorStop(1, 'rgba(255,210,138,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    ctx.restore();
    roundRect(ctx, 18, 18, W - 36, H - 36, 20); ctx.fillStyle = C.panel; ctx.fill();

    // avatar
    const ax = 52, ay = 61, ad = 160;
    const avatar = d.avatarImage || await fetchAvatar(d.avatarUrl);
    ctx.save();
    ctx.beginPath(); ctx.arc(ax + ad / 2, ay + ad / 2, ad / 2, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
    if (avatar) ctx.drawImage(avatar, ax, ay, ad, ad);
    else {
        ctx.fillStyle = '#3b2a80'; ctx.fillRect(ax, ay, ad, ad);
        ctx.fillStyle = C.amber; ctx.font = `700 78px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(safeName(d.name)[0].toUpperCase(), ax + ad / 2, ay + ad / 2 + 4);
    }
    ctx.restore();
    ctx.lineWidth = 6; ctx.strokeStyle = C.amber;
    ctx.beginPath(); ctx.arc(ax + ad / 2, ay + ad / 2, ad / 2 + 2, 0, Math.PI * 2); ctx.stroke();

    // rank + level (right aligned, measured so nothing overlaps)
    const left = 252, right = W - 52;
    const stats = [['LEVEL', String(d.level), C.amber], ['RANK', `#${fmt(d.rank)}`, C.text]];
    let x = right;
    ctx.textBaseline = 'alphabetic';
    for (const [label, value, color] of stats) {
        ctx.font = `700 46px ${FONT}`;
        const vw = ctx.measureText(value).width;
        ctx.font = `700 18px ${FONT}`;
        const lw = ctx.measureText(label).width;
        ctx.textAlign = 'right';
        ctx.font = `700 46px ${FONT}`; ctx.fillStyle = color; ctx.fillText(value, x, 100);
        ctx.font = `700 18px ${FONT}`; ctx.fillStyle = C.muted; ctx.fillText(label, x - vw - 8, 100);
        x -= vw + 8 + lw + 36;
    }

    // name takes whatever room is left
    ctx.textAlign = 'left';
    ctx.font = `700 40px ${FONT}`; ctx.fillStyle = C.text;
    ctx.fillText(fitText(ctx, safeName(d.name), Math.max(120, x + 36 - left - 16)), left, 98);

    // xp text
    ctx.textAlign = 'left';
    ctx.font = `500 22px ${FONT}`; ctx.fillStyle = C.muted;
    ctx.fillText(d.atMax ? 'Max level reached' : `${fmt(d.into)} / ${fmt(d.needed)} XP to next level`, left, 170);
    ctx.textAlign = 'right';
    ctx.fillText(`${compact(d.xp)} total XP · ${fmt(d.total)} ranked`, right, 170);

    // progress bar
    const bx = left, by = 190, bw = right - left, bh = 38;
    roundRect(ctx, bx, by, bw, bh, bh / 2); ctx.fillStyle = C.track; ctx.fill();
    const fillW = Math.max(bh, Math.round(bw * Math.min(1, Math.max(0, d.ratio))));
    if (d.ratio > 0 || d.atMax) {
        const pg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
        pg.addColorStop(0, C.amber2); pg.addColorStop(1, C.amber);
        roundRect(ctx, bx, by, fillW, bh, bh / 2); ctx.fillStyle = pg; ctx.fill();
    }

    return canvas.toBuffer('image/png');
}

module.exports = { renderRankCard, safeName, W, H };

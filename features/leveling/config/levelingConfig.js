// features/leveling/config/levelingConfig.js
//
// Static defaults and limits for the leveling system. Per-server values live in
// MongoDB (collection `level_config`) and are edited with /level-config.
//
// Optional env var:
//   LEVELING_DEFAULT_ENABLED   "false" = leveling is OFF in servers that have not
//                              enabled it with /level-config (default: on)

const PRESETS = {
    classic: { label: 'Classic (balanced)', a: 5, b: 50, c: 100 },
    easy:    { label: 'Easy (faster levels)', a: 2, b: 30, c: 60 },
    hard:    { label: 'Hard (slower levels)', a: 8, b: 80, c: 150 }
};

module.exports = {
    COLLECTIONS: {
        config:  'level_config',
        members: 'level_members',
        periods: 'level_periods'
    },

    DEFAULTS: {
        enabled: process.env.LEVELING_DEFAULT_ENABLED !== 'false',
        xpMin: 15,
        xpMax: 25,
        cooldownSec: 60,
        progression: { a: 5, b: 50, c: 100 },   // XP to go from level n to n+1 = a*n² + b*n + c
        announce: {
            enabled: true,
            channelId: null,                    // null = same channel as the message
            message: '🎉 {user} reached **level {level}**!'
        },
        rewardMode: 'stack',                    // 'stack' | 'replace'
        rewards: [],                            // [{ level, roleId }]
        ignoredChannels: [],
        ignoredRoles: [],
        leaderboard: { public: false, slug: null }   // public web leaderboard (opt-in)
    },

    PRESETS,

    LIMITS: {
        MAX_LEVEL: 1000,
        MAX_XP_PER_MESSAGE: 1000,
        MIN_COOLDOWN_SEC: 0,
        MAX_COOLDOWN_SEC: 3600,
        MAX_REWARDS: 25,
        MAX_IGNORED: 25,                        // a Discord select menu holds at most 25 values
        MAX_MESSAGE_LENGTH: 300,
        MAX_COEFFICIENT: 100000,
        MAX_MANUAL_XP: 100000000
    },

    // Anti-spam (not configurable — kept simple and predictable)
    ANTI_SPAM: {
        MIN_TEXT_LENGTH: 3,        // characters left after removing mentions/links/emoji
        MIN_UNIQUE_CHARS: 3,       // "aaaaaaa" earns nothing
        DUPLICATE_WINDOW_MS: 10 * 60 * 1000,
        DUPLICATE_HISTORY: 5       // remember this many recent messages per member
    },

    CONFIG_CACHE_MS: 60 * 1000,
    LEADERBOARD_PAGE_SIZE: 10,
    PUBLIC_LEADERBOARD_PAGE_SIZE: 25,
    PUBLIC_LEADERBOARD_MAX_PAGES: 40,           // top 1000 only
    // Weekly / monthly rows are deleted automatically after this long.
    PERIOD_RETENTION_DAYS: 100
};

// features/leveling/config/ladder.js
// A ready-made "rank ladder": a title for every level 1–50 and 11 milestone roles.
// Used by the dashboard's "Rank ladder" panel (creates / matches the roles and sets the
// rewards) and by the {title} placeholder in level-up messages.

const TITLES = [
    'New Leaf', 'Sprout', 'Seedling', 'Early Bloom', 'Cozy Visitor',
    'Porch Sitter', 'Tea Sipper', 'Blanket Borrower', 'Bookmark Keeper', 'Corner Regular',
    'Storyteller', 'Candle Lighter', 'Window Gazer', 'Rainy-Day Reader', 'Lantern Keeper',
    'Quilt Maker', 'Fireside Friend', 'Cocoa Brewer', 'Page Turner', 'Hearth Warden',
    'Moss Walker', 'Dusk Wanderer', 'Lamp Lighter', 'Ink & Quill', 'Story Weaver',
    'Starwatcher', 'Moonlit Poet', 'Dream Collector', 'Night Owl', 'Moonlit Sage',
    'Comet Chaser', 'Aurora Seeker', 'Constellation Mapper', 'Skylight Dweller', 'Starlight Keeper',
    'Archway Walker', 'Door Opener', 'Key Bearer', 'Threshold Watcher', 'Nook Guardian',
    'Hall Architect', 'Gilded Hinge', 'Ember Crowned', 'Grand Curator', 'Grand Architect',
    'Luminary', 'Radiant Warden', 'Eternal Flame', 'Nook Elder', 'Nook Legend'
];

// level → role. The role name is the title of that level. `perk` is a suggestion for what the
// role could unlock in the server (Nook does not enforce perks; they are set with channel/role permissions).
const TIERS = [
    { level: 1,  color: '#7ED957', perk: 'Welcome to the server: chat and react everywhere' },
    { level: 5,  color: '#2DD4BF', perk: 'Attach files and embed links' },
    { level: 10, color: '#38BDF8', perk: 'Change your nickname and use external emojis' },
    { level: 15, color: '#6366F1', perk: 'Pick your own name colour' },
    { level: 20, color: '#A855F7', perk: 'Create public threads and use external stickers' },
    { level: 25, color: '#D946EF', perk: 'Access to the VIP lounge channel' },
    { level: 30, color: '#F472B6', perk: 'Start polls and get priority speaker in voice' },
    { level: 35, color: '#FB7185', perk: 'Early look at announcements (sneak-peek channel)' },
    { level: 40, color: '#FB923C', perk: 'Custom role icon' },
    { level: 45, color: '#FBBF24', perk: 'Private "Inner Nook" channel with the staff' },
    { level: 50, color: '#F5C542', perk: 'Hall of Fame spot and a custom role name and colour' }
].map(t => ({ ...t, role: TITLES[t.level - 1] }));

const titleForLevel = level => (level <= 0 ? 'Newcomer' : TITLES[Math.min(level, TITLES.length) - 1]);

module.exports = { TITLES, TIERS, titleForLevel };

// features/leveling/leveling.js
// Server leveling: XP from chat, /rank /level /leaderboard, role rewards, /level-config.
// See README.md in this folder.
const {
    Events, SlashCommandBuilder, InteractionContextType, ApplicationIntegrationType, PermissionFlagsBits, MessageFlags
} = require('discord.js');
const cfg = require('./config/levelingConfig');
const configService = require('./services/configService');
const xpService = require('./services/xpService');
const rewardService = require('./services/rewardService');
const messageHandler = require('./handlers/messageHandler');
const commandHandler = require('./handlers/commandHandler');
const configPanel = require('./handlers/configPanel');

// Server-only commands. (Moderation pins ITS commands to guilds; ours must be pinned here.)
const guildOnly = b => b
    .setContexts(InteractionContextType.Guild)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall);

const memberOption = o => o.setName('member').setDescription('Another member (default: you)').setRequired(false);

const commands = [
    guildOnly(new SlashCommandBuilder().setName('rank').setDescription('Show a member\'s rank card')
        .addUserOption(memberOption)),
    guildOnly(new SlashCommandBuilder().setName('level').setDescription('Level progress and role rewards')
        .addSubcommand(s => s.setName('progress').setDescription('Your current level and XP progress').addUserOption(memberOption))
        .addSubcommand(s => s.setName('rewards').setDescription('Roles you can unlock by leveling up'))),
    guildOnly(new SlashCommandBuilder().setName('leaderboard').setDescription('The server XP leaderboard')
        .addStringOption(o => o.setName('period').setDescription('Which leaderboard (default: all-time)')
            .addChoices({ name: 'All-time', value: 'alltime' }, { name: 'Weekly', value: 'weekly' }, { name: 'Monthly', value: 'monthly' }))),
    guildOnly(new SlashCommandBuilder().setName('level-config').setDescription('Configure leveling for this server (admins)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild))
];

const handlers = {
    rank: i => commandHandler.handleRank(i),
    leaderboard: i => commandHandler.handleLeaderboard(i),
    'level-config': i => configPanel.open(i),
    level: i => i.options.getSubcommand() === 'rewards' ? commandHandler.handleLevelRewards(i) : commandHandler.handleLevelProgress(i)
};

async function safeReply(interaction, content) {
    try {
        if (interaction.deferred || interaction.replied) await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
        else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    } catch { /* interaction expired — nothing more to do */ }
}

module.exports = (client) => {
    // Commands are registered together by the moderation feature (one commands.set() call
    // replaces all global commands) → leveling must be initialised BEFORE moderation.
    (client.extraSlashCommands ||= []).push(...commands);

    client.once(Events.ClientReady, async () => {
        try {
            await Promise.all([configService.ensureIndexes(), xpService.ensureIndexes()]);
        } catch (err) {
            console.error('❌ [leveling] Failed to create indexes:', err);
        }
    });

    client.on(Events.MessageCreate, (message) => {
        messageHandler.handle(message).catch(err => console.error('❌ [leveling] Message error:', err));
    });

    client.on(Events.InteractionCreate, async (interaction) => {
        try {
            if (interaction.isChatInputCommand()) {
                const run = handlers[interaction.commandName];
                if (run) await run(interaction);
                return;
            }
            const id = interaction.customId;
            if (typeof id !== 'string' || !id.startsWith('lvl:')) return;
            if (id.startsWith('lvl:cfg:')) {
                if (interaction.isModalSubmit()) await configPanel.handleModal(interaction);
                else if (interaction.isMessageComponent()) await configPanel.handleComponent(interaction);
            } else if (id.startsWith('lvl:lb') && interaction.isMessageComponent()) {
                await commandHandler.handleLeaderboardComponent(interaction);
            }
        } catch (err) {
            console.error('❌ [leveling] Interaction error:', err);
            await safeReply(interaction, '❌ Something went wrong with leveling. Please try again in a moment.');
        }
    });

    // A returning member gets their reward roles back.
    client.on(Events.GuildMemberAdd, async (member) => {
        try {
            if (member.user.bot) return;
            const config = await configService.get(member.guild.id);
            if (!config.enabled || !config.rewards.length) return;
            const doc = await xpService.getMember(member.guild.id, member.id);
            if (doc?.level > 0) await rewardService.syncMemberRewards(member, doc.level, config);
        } catch (err) {
            console.error('❌ [leveling] Rejoin sync failed:', err.message);
        }
    });

    // Deleted roles / channels are dropped from the settings.
    client.on(Events.GuildRoleDelete, role => configService.pruneRole(role.guild.id, role.id).catch(() => {}));
    client.on(Events.ChannelDelete, ch => { if (ch.guild) configService.pruneChannel(ch.guild.id, ch.id).catch(() => {}); });

    console.log('📈 Leveling system initialized');
};

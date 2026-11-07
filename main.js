// main.js
const { Client, GatewayIntentBits, Partials } = require('discord.js');
require('dotenv').config();

const databaseService = require('./features/tickets/services/databaseService');
const ticketsFeature   = require('./features/tickets/tickets');
const moderationFeature = require('./features/moderation/moderation');
const rolesFeature     = require('./features/roles/roles');
const mediaFeature     = require('./features/media/media');
const levelingFeature  = require('./features/leveling/leveling');
const dashboardFeature = require('./features/dashboard/dashboard');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildBans,
        GatewayIntentBits.DirectMessages   // media library: prefix commands in DMs
    ],
    partials: [Partials.Channel]           // required to receive DM messages
});

async function initializeBot() {
    try {
        await databaseService.connect();

        ticketsFeature(client);
        // Media and leveling MUST be initialised before moderation: moderation registers all
        // slash commands in one call and picks up client.extraSlashCommands.
        mediaFeature(client);
        levelingFeature(client);
        moderationFeature(client);
        rolesFeature(client);
        dashboardFeature(client);   // web API for the Nook website (disabled unless configured)

        console.log('🤖 Bot features initialized');
    } catch (error) {
        console.error('❌ Failed to initialize bot:', error);
        process.exit(1);
    }
}

client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} is online!`);
    console.log(`📊 Serving ${client.guilds.cache.size} guilds`);

    const dbHealthy = await databaseService.ping();
    console.log(`🗄️ Database status: ${dbHealthy ? 'Healthy' : 'Unhealthy'}`);
});

client.on('warn',  warning => console.warn('⚠️ Discord client warning:', warning));
client.on('error', error   => console.error('❌ Discord client error:', error));

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', error => {
    console.error('❌ Uncaught Exception:', error);
    process.exit(1);
});

process.on('SIGINT', async () => {
    console.log('🛑 Received SIGINT, shutting down gracefully...');
    await databaseService.disconnect();
    client.destroy();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('🛑 Received SIGTERM, shutting down gracefully...');
    await databaseService.disconnect();
    client.destroy();
    process.exit(0);
});

async function startBot() {
    try {
        await initializeBot();
        await client.login(process.env.DISCORD_TOKEN);
    } catch (error) {
        console.error('❌ Failed to start bot:', error);
        process.exit(1);
    }
}

startBot();
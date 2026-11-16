// features/moderation/moderation.js
const { Collection, Events } = require('discord.js');
const { createHash }  = require('crypto');
const { readFileSync, writeFileSync, mkdirSync } = require('fs');
const { join }        = require('path');

const slashCommandHandler  = require('./handlers/slashCommandHandler');
const prefixCommandHandler = require('./handlers/prefixCommandHandler');
const banCommand    = require('./commands/ban');
const unbanCommand  = require('./commands/unban');
const kickCommand   = require('./commands/kick');
const muteCommand   = require('./commands/mute');
const unmuteCommand = require('./commands/unmute');
const warnCommand   = require('./commands/warn');
const warnsCommand  = require('./commands/warns');
const { handleWarnsButton }      = require('./commands/warns');
const { handleWarnRemoveButton } = require('./commands/warn');
const warningService = require('./services/warningService');
const caseService    = require('./services/caseService');
const expiryService  = require('./services/expiryService');
const caseCommand    = require('./commands/case');

const PREFIX = '!';

// ─── Persistent command-hash helpers ─────────────────────────────────────────
// We persist the hash of registered slash-command definitions to a small file
// so that bot restarts skip re-registration when nothing has changed.
// Discord's global command registration is rate-limited and propagation can
// take up to an hour, so avoiding unnecessary calls is worthwhile.

const HASH_DIR  = join(__dirname, '../../.cache');
const HASH_FILE = join(HASH_DIR, 'slash-command-hash.txt');

function readPersistedHash() {
    try {
        return readFileSync(HASH_FILE, 'utf8').trim();
    } catch {
        return null; // File doesn't exist yet on first run
    }
}

function writePersistedHash(hash) {
    try {
        mkdirSync(HASH_DIR, { recursive: true });
        writeFileSync(HASH_FILE, hash, 'utf8');
    } catch (err) {
        // Non-fatal — worst case we re-register on the next restart
        console.warn('⚠️  Could not persist command hash:', err.message);
    }
}

function hashCommands(commandsJson) {
    return createHash('sha256').update(JSON.stringify(commandsJson)).digest('hex');
}

async function registerCommandsIfChanged(client, commands) {
    const currentHash  = hashCommands(commands);
    const persistedHash = readPersistedHash();

    if (persistedHash === currentHash) {
        console.log('✅ Slash commands unchanged — skipping re-registration');
        return;
    }

    console.log('🔨 Registering moderation slash commands globally...');
    await client.application.commands.set(commands);
    writePersistedHash(currentHash);
    console.log('✅ Moderation slash commands registered globally');
    console.log('📝 Note: Global commands may take up to 1 hour to appear in all servers');
}

// ─── Module initialisation ────────────────────────────────────────────────────
module.exports = (client) => {
    client.moderationCommands = new Collection();
    client.moderationCommands.set('ban',    banCommand);
    client.moderationCommands.set('unban',  unbanCommand);
    client.moderationCommands.set('kick',   kickCommand);
    client.moderationCommands.set('mute',   muteCommand);
    client.moderationCommands.set('unmute', unmuteCommand);
    client.moderationCommands.set('warn',   warnCommand);
    client.moderationCommands.set('warns',  warnsCommand);
    client.moderationCommands.set('case',   caseCommand);

    client.once(Events.ClientReady, async () => {
        try {
            const commands = [];
            for (const command of client.moderationCommands.values()) {
                if (command.slashCommand) {
                    const json = command.slashCommand.toJSON();
                    // Keep moderation guild-only even if the app has User Install enabled
                    // in the Developer Portal (they rely on interaction.member).
                    json.integration_types = [0];   // GuildInstall
                    json.contexts = [0];            // Guild
                    commands.push(json);
                }
            }
            // Slash commands contributed by other features (e.g. media). Must be part of
            // this single commands.set() call or they would be wiped on registration.
            for (const extra of client.extraSlashCommands ?? []) commands.push(extra.toJSON());
            await registerCommandsIfChanged(client, commands);
            await warningService.ensureIndexes();
            await caseService.ensureIndexes();
            try {
                const n = await caseService.backfillWarnings(warningService._col());
                if (n) console.log(`✅ Backfilled ${n} warning case(s) into the moderation database`);
            } catch (e) { console.error('❌ Case backfill failed:', e); }
            expiryService.start(client);
        } catch (error) {
            console.error('❌ Failed to register moderation slash commands:', error);
        }
    });

    // ── Interaction handler ───────────────────────────────────────────────────
    client.on(Events.InteractionCreate, async (interaction) => {

        // Button interactions
        if (interaction.isButton()) {
            const id = interaction.customId;

            if (id.startsWith('warnrm_')) {
                try {
                    await handleWarnRemoveButton(interaction, interaction.guild);
                } catch (error) {
                    console.error('❌ Error handling warn remove button:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '❌ An error occurred.', ephemeral: true });
                    }
                }
                return;
            }

            if (id.startsWith('warns_lb_') || id.startsWith('warns_user_')) {
                try {
                    await handleWarnsButton(interaction);
                } catch (error) {
                    console.error('❌ Error handling warns button:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '❌ An error occurred.', ephemeral: true });
                    }
                }
                return;
            }
        }

        // Slash commands
        if (!interaction.isChatInputCommand()) return;

        const command = client.moderationCommands.get(interaction.commandName);
        if (!command) return;

        try {
            await slashCommandHandler.handle(interaction, command);
        } catch (error) {
            console.error('❌ Error handling slash command:', error);
            const errorMessage = { content: '❌ An error occurred while executing this command.', ephemeral: true };
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(errorMessage);
            } else {
                await interaction.reply(errorMessage);
            }
        }
    });

    // ── Prefix command handler ────────────────────────────────────────────────
    client.on(Events.MessageCreate, async (message) => {
        if (message.author.bot) return;
        if (!message.guild) return; // guild-only; DMs are enabled for other features
        if (!message.content.startsWith(PREFIX)) return;

        const args        = message.content.slice(PREFIX.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        const command = client.moderationCommands.get(commandName);
        if (!command) return;

        try {
            await prefixCommandHandler.handle(message, command, args);
        } catch (error) {
            console.error('❌ Error handling prefix command:', error);
            await message.reply('❌ An error occurred while executing this command.');
        }
    });

    console.log('🔨 Moderation system initialized');
};
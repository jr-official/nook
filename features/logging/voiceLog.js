// features/logging/voiceLog.js — joining, moving between and leaving voice channels.
const { Events, EmbedBuilder } = require('discord.js');
const { send, eventOn, isIgnored } = require('./config');

function register(client) {
    client.on(Events.VoiceStateUpdate, async (a, b) => {
        try {
            const guild = b.guild ?? a.guild; const member = b.member ?? a.member; if (!guild || !member) return;
            if (a.channelId === b.channelId) return;                      // mute/deafen/stream changes only
            const who = `${member.user.tag} (${member.user.id})`;
            const ign = id => { const c = guild.channels.cache.get(id); return isIgnored(id, c?.parentId); };
            let key, title, color, desc;
            if (!a.channelId && b.channelId) { key = 'voice_join'; title = '🔊 Joined voice'; color = '#43b581'; desc = `${who} joined <#${b.channelId}>`; if (ign(b.channelId)) return; }
            else if (a.channelId && !b.channelId) { key = 'voice_leave'; title = '🔇 Left voice'; color = '#a0a0a8'; desc = `${who} left <#${a.channelId}>`; if (ign(a.channelId)) return; }
            else { key = 'voice_move'; title = '🔀 Moved voice channel'; color = '#5865f2'; desc = `${who} moved <#${a.channelId}> → <#${b.channelId}>`; if (ign(a.channelId) && ign(b.channelId)) return; }
            if (!eventOn(key)) return;
            await send(guild, 'voice', new EmbedBuilder().setColor(color).setTitle(title).setDescription(desc).setTimestamp());
        } catch (err) { console.error('[logging] voiceState:', err.message); }
    });
}

module.exports = { register };

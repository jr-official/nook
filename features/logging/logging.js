// features/logging/logging.js — CarlBot-style logging: message, member, join/leave, server and voice logs,
// plus recording moderation done by hand (bans, kicks, timeouts) as cases.
const messageLog = require('./messageLog');
const memberLog = require('./memberLog');
const serverLog = require('./serverLog');
const voiceLog = require('./voiceLog');

module.exports = (client) => { messageLog.register(client); memberLog.register(client); serverLog.register(client); voiceLog.register(client); };

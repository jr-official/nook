// features/logging/logging.js — member and message logs, plus recording moderation done by hand.
const messageLog = require('./messageLog');
const memberLog = require('./memberLog');

module.exports = (client) => { messageLog.register(client); memberLog.register(client); };

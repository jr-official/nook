// features/tickets/tickets.js
const { setupMessageHandler }     = require('./handlers/messageHandler');
const { setupInteractionHandler } = require('./handlers/interactionHandler');
const CacheService                = require('./services/cacheService');
const reconcileService            = require('./services/reconcileService');

module.exports = function initializeTicketsFeature(client) {
    // FIX: create a shared CacheService instance and register role listeners so
    // that cache invalidation happens automatically when the Staff role is renamed
    // or deleted. Previously each handler file instantiated its own CacheService
    // silently, and invalidate() was never called anywhere in the codebase.
    //
    // The shared instance is passed into setup functions so handlers use the same
    // cache rather than separate per-handler instances that never share state.
    const cacheService = new CacheService();
    cacheService.registerRoleListeners(client);

    setupMessageHandler(client);
    setupInteractionHandler(client, cacheService);
    reconcileService.start(client);

    console.log('✅ Tickets feature initialized');
};